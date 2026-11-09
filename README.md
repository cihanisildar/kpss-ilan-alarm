# KPSS İlan Alarmı

ilan.gov.tr'deki **personel** ilanlarını tarar. Seçtiğin il veya bölgede, anahtar kelimelerine uyan yeni bir kamu ilanı çıktığında Telegram'dan bildirim gönderir. Son başvuruya 2 gün kala da hatırlatır.

Hiçbir npm paketi gerektirmez. İki şekilde çalışır: **bulutta** (Vercel, bilgisayar kapalıyken de) veya **bilgisayarında** (`baslat.bat`).

## Gereksinim
- Node.js **22.13 veya üstü** (`node -v` ile kontrol et)

## ☁️ Bulutta 7/24 çalıştırma (ücretsiz: Vercel + Upstash + cron-job.org)
Bilgisayarın kapalıyken de çalışır. Üç servis de ücretsiz ve kredi kartı istemiyor.

| Parça | Görevi |
|---|---|
| **Vercel** | Kod burada çalışır. Telegram komutları webhook ile anında cevaplanır |
| **Upstash Redis** | Görülen ilanların listesi burada tutulur (Vercel'de kalıcı disk yok) |
| **cron-job.org** | 15 dakikada bir `/api/cron` adresini çağırarak taramayı başlatır (Vercel'in ücretsiz planı günde yalnızca 1 zamanlanmış görev çalıştırabiliyor) |

### 1. Telegram botu
@BotFather → `/newbot` → **token**'ı kopyala.

### 2. Kodu GitHub'a yükle
GitHub'da **private** bir repo aç (ör. `kpss-ilan-alarm`) ve bu klasörü yükle. `.env` ve `data/` zaten `.gitignore`'da, yüklenmez.
```
git init && git add . && git commit -m "kpss ilan alarmı"
git branch -M main
git remote add origin https://github.com/<kullanıcı-adın>/kpss-ilan-alarm.git
git push -u origin main
```

### 3. Vercel'e bağla
1. vercel.com → **Add New → Project** → repoyu seç → **Deploy**. Framework: *Other*, başka ayar gerekmez.
2. Proje → **Storage → Create Database → Upstash for Redis** (ücretsiz plan) → projeye bağla. `KV_REST_API_URL` ve `KV_REST_API_TOKEN` otomatik eklenir.
3. Proje → **Settings → Environment Variables** bölümüne şunları ekle:
   - `TELEGRAM_BOT_TOKEN`: BotFather'ın verdiği token
   - `CRON_SECRET`: kendin uydurduğun uzun, rastgele bir şifre (ör. `kpss-8f3k2m9x7q`)
   - `TELEGRAM_CHAT_ID`: şimdilik boş bırak, 4. adımda öğreneceksin
4. **Deployments → ... → Redeploy** (ortam değişkenlerinin devreye girmesi için).

### 4. Webhook'u kur ve chat ID'ni öğren
1. Tarayıcıda aç: `https://<proje-adın>.vercel.app/api/setup?key=<CRON_SECRET>`. Ekranda ✅ satırları görünmeli.
2. Telegram'da botuna `/start` yaz. Bot sana **chat ID**'ni söyler.
3. Bu numarayı Vercel'de `TELEGRAM_CHAT_ID` olarak ekle, **Redeploy** et ve setup adresini bir kez daha aç. Telegram'a "bulutta çalışıyor" mesajı gelir.

### 5. Otomatik taramayı aç (cron-job.org)
cron-job.org'a ücretsiz üye ol → **Create cronjob**:
- URL: `https://<proje-adın>.vercel.app/api/cron?key=<CRON_SECRET>`
- Zamanlama: **her 15 dakikada bir**
- Kaydet. **Test run** ile denersen `{"ok":true,...}` cevabı görmelisin.

Hepsi bu kadar. İlk tarama mevcut ilanların özetini gönderir, sonrakiler sadece yeni ilan çıkınca mesaj atar.

**Ayar değiştirmek:** `config.json`'u düzenle ve GitHub'a push et, Vercel otomatik yeniden deploy eder.

**Not:** Vercel fonksiyonları Frankfurt'ta (`fra1`) çalışır. ilan.gov.tr yurt dışı IP'lerini engellerse `/durum` komutunda hata görünür ve bot "Veri gelmiyor" uyarısı atar.

---

## 💻 Bilgisayarda çalıştırma

### Telegram kurulumu (lokal)
1. Telegram'da **@BotFather**'ı aç, `/newbot` yaz. Bota bir ad ve kullanıcı adı ver, verdiği **token**'ı kopyala.
2. Bu klasörde `.env.example` dosyasının bir kopyasını oluştur, adını `.env` yap ve token'ı `TELEGRAM_BOT_TOKEN=` satırına yapıştır.
3. `baslat.bat` ile botu başlat, Telegram'da kendi botunu açıp `/start` yaz. Bot sana **chat ID**'ni yazar. Bu numarayı `.env` dosyasındaki `TELEGRAM_CHAT_ID=` satırına yaz.
4. Botu kapatıp yeniden başlat. İlk açılışta mevcut ilanların özeti gelir.

Bot sadece `.env`'deki chat ID'ye cevap verir. Başkası botunu bulsa bile kullanamaz.

## Telegram komutları (iki modda da aynı)
| Komut | Ne yapar |
|---|---|
| `/tara` | Hemen tarar. Yeni ilan varsa her biri ayrı mesaj olarak gelir, yoksa "yeni ilan yok" der |
| `/liste` | Alarmına uyan, süresi geçmemiş ilanlar: kurum, il, son başvuru, link |
| `/tumu` | Taranan tüm güncel ilanlar, alarmına uyanlar ✅ ile işaretli |
| `/durum` | Son taramanın sonucu ve sonraki taramanın saati |
| `/alarmlar` | İzlenen iller ve anahtar kelimeler |
| `/yardim` | Komut listesi |

Otomatik taramalar (varsayılan 20 dakikada bir) sadece **yeni** ve alarmına uyan bir ilan çıkınca mesaj atar. Değişiklik yoksa sessiz kalır. Son başvuruya 2 gün kala hatırlatma da gönderir.

## Çalıştırma
| Komut | Ne yapar |
|---|---|
| `baslat.bat` veya `npm start` | Sürekli çalışır, Telegram komutlarını dinler |
| `deneme.bat` veya `npm run dry` | Tek tarama yapar, Telegram'a göndermez |

Botun çalışması için bilgisayarın açık ve pencerenin açık kalması gerekir. Baştan başlamak için `data/` klasörünü sil.

## Alarm ayarları: `config.json`
```json
{
  "name": "Bilişim / Yazılım - Marmara",
  "regions": ["Marmara"],
  "cities": [7, 6],
  "keywords": ["bilgisayar muhendis", "yazilimci"],
  "exclude": ["ogretim uyesi"],
  "searchContent": true
}
```
- **cities**: İl plaka kodları. **regions**: `Marmara`, `Ege`, `Akdeniz`, `İç Anadolu`, `Karadeniz`, `Doğu Anadolu`, `Güneydoğu Anadolu`. İkisi birlikte kullanılabilir. İkisi de boş bırakılırsa tüm Türkiye taranır.
- **keywords**: Listedeki ifadelerden biri geçerse eşleşir. Bir ifadedeki kelimelerin hepsi geçmeli. Türkçe karakter ve büyük/küçük harf farkı önemsiz: `muhendis`, "Mühendisi" ve "MÜHENDİSLİĞİ" ile de eşleşir. Liste boş bırakılırsa o ildeki tüm personel ilanları bildirilir.
- **exclude**: Bu ifadeler geçen ilanlar atlanır.
- **searchContent**: Başlık eşleşmezse ilanın tam metninde de arar. Varsayılan `true`. "Sözleşmeli Personel Alım İlanı" gibi genel başlıklı ilanları yakalamak için gerekli.

Birden fazla alarm tanımlanabilir. Bir ilan yalnızca ilk eşleşen alarm için bildirilir.

## Nasıl çalışır
- Arama: `POST /api/api/services/app/Ad/AdsByFilter`, `ats=5` (PERSONEL), `aci=<şehir id>`, `ppdmin=<tarih>`
- Detay: `GET /api/api/services/app/AdDetail/GetAdDetail?id=...`. İlan metni ve son başvuru tarihi buradan alınır.
- Görülen ilanlar lokalde `data/ilanlar.db` (SQLite), bulutta Upstash Redis'te tutulur. Aynı kurum ve aynı başlıkla tekrar yayımlanan ilan ikinci kez bildirilmez.
- **Sağlık kontrolü**: Art arda 3 tarama hata verirse veya hiç ilan dönmezse "Veri gelmiyor" uyarısı gönderilir.

## Sınırlar / sonraki adımlar
- Uçlar resmî değildir. Site değişirse `src/ilangov.js` güncellenmelidir.
- Kariyer Kapısı henüz eklenmedi. Kaynak eklemek için `searchPersonnelAds` ile aynı biçimde ilan döndüren yeni bir modül yazmak yeterli.
- İl bilgisi ilanı veren kurumun adresinden alınır. Örneğin Ankara'daki bir bakanlığın taşra kadrosu ilanı "Ankara" olarak görünür.
- Webhook kuruluyken lokal `baslat.bat` Telegram komutlarını dinlemez, buluttaki botu bozmasın diye. Lokalde komut kullanmak için bota `deleteWebhook` gönderilmesi gerekir.
