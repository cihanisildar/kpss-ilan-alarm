// ilan.gov.tr sunucusu sertifika zincirindeki ara sertifikayı göndermiyor
// (Node: UNABLE_TO_VERIFY_LEAF_SIGNATURE). Tarayıcılar eksiği AIA ile kendileri tamamlar;
// burada da aynısını yapıyoruz: sunucu sertifikasındaki "CA Issuers" adresinden ara sertifikayı
// indirip güvenilir listeye ekliyoruz. TLS doğrulaması KAPATILMAZ.
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const agents = new Map(); // host -> https.Agent

// Varsayılan kök sertifikalar (+ NODE_EXTRA_CA_CERTS / --use-system-ca varsa onlar da)
const defaultRoots = () =>
  typeof tls.getCACertificates === 'function' ? tls.getCACertificates('default') : tls.rootCertificates;

function caIssuerUrl(infoAccess) {
  if (!infoAccess) return null;
  // tls.getPeerCertificate() -> nesne: { 'CA Issuers - URI': ['http://...'] }
  if (typeof infoAccess === 'object') {
    const list = infoAccess['CA Issuers - URI'];
    return Array.isArray(list) && list.length ? list[0] : null;
  }
  // X509Certificate.infoAccess -> metin: "CA Issuers - URI:http://...\nOCSP - URI:..."
  const m = String(infoAccess).match(/CA Issuers - URI:(\S+)/);
  return m ? m[1] : null;
}

function download(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    mod
      .get(url, { timeout: 20_000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).href, redirects - 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`AIA indirme HTTP ${res.statusCode}: ${url}`));
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject)
      .on('timeout', function () { this.destroy(new Error('AIA indirme zaman aşımı')); });
  });
}

function peerCert(host, port = 443) {
  return new Promise((resolve, reject) => {
    // Sadece sertifikayı OKUMAK için doğrulamasız bağlanıyoruz; veri göndermiyoruz.
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate(false);
      s.end();
      resolve(c);
    });
    s.setTimeout(20_000, () => s.destroy(new Error('TLS zaman aşımı')));
    s.on('error', reject);
  });
}

const toX509 = (buf) => {
  const s = buf.toString('latin1');
  return new X509Certificate(s.includes('-----BEGIN') ? s : buf);
};

async function fetchIntermediates(host, port) {
  const pems = [];
  let info = (await peerCert(host, port)).infoAccess;
  for (let depth = 0; depth < 3; depth++) {
    const url = caIssuerUrl(info);
    if (!url) break;
    const cert = toX509(await download(url));
    pems.push(cert.toString());
    if (cert.issuer === cert.subject) break; // köke ulaştık
    info = cert.infoAccess;
  }
  if (!pems.length) throw new Error(`${host} için ara sertifika bulunamadı`);
  return pems;
}

/** cachePath: indirilen ara sertifikaların saklanacağı dosya (data/ca-<host>.pem) */
export async function agentFor(host, cachePath, { refresh = false, port = 443 } = {}) {
  if (agents.has(host) && !refresh) return agents.get(host);
  let pems = null;
  if (!refresh && cachePath && existsSync(cachePath)) {
    pems = readFileSync(cachePath, 'utf8').split(/(?=-----BEGIN CERTIFICATE-----)/).filter((p) => p.trim());
  }
  if (!pems) {
    pems = await fetchIntermediates(host, port);
    if (cachePath) {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, pems.join('\n'));
    }
  }
  const agent = new https.Agent({ keepAlive: true, ca: [...defaultRoots(), ...pems] });
  agents.set(host, agent);
  return agent;
}

const CHAIN_ERRORS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
]);

/** JSON isteği; sertifika zinciri hatasında ara sertifikayı otomatik tamamlar. */
export async function requestJson(url, { method = 'GET', headers = {}, body, cacheDir } = {}) {
  const u = new URL(url);
  const cachePath = cacheDir ? `${cacheDir}/ca-${u.hostname}.pem` : null;
  const once = (agent) =>
    new Promise((resolve, reject) => {
      const req = https.request(u, { method, headers, agent, timeout: 30_000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} ${url} ${text.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(text)); } catch { reject(new Error(`JSON değil: ${text.slice(0, 200)}`)); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('istek zaman aşımı')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  // Önceden indirilmiş ara sertifika varsa doğrudan onu kullan
  if (agents.has(u.hostname) || (cachePath && existsSync(cachePath))) {
    try {
      return await once(await agentFor(u.hostname, cachePath));
    } catch (e) {
      if (!CHAIN_ERRORS.has(e.code)) throw e;
      return once(await agentFor(u.hostname, cachePath, { refresh: true, port: Number(u.port) || 443 })); // sertifika yenilenmiş olabilir
    }
  }
  try {
    return await once(undefined);
  } catch (e) {
    if (!CHAIN_ERRORS.has(e.code)) throw e;
    return once(await agentFor(u.hostname, cachePath, { refresh: true, port: Number(u.port) || 443 }));
  }
}
