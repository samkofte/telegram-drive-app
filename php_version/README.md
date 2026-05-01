# Telegram Drive PHP

Telegram Drive'in PHP tabanli ana backend ve web arayuzu. Bu klasor; auth, upload, preview, stream, cop kutusu, paylasim, ZIP indirme ve web dashboard akislarini tek katmanda toplar.

## Ozellikler

- Telegram'i depolama backend'i olarak kullanma
- JWT tabanli auth ve profil yonetimi
- MySQL uzerinde dosya, klasor ve paylasim metadata'si
- Klasor olusturma, renk ve ikon secimi
- Favoriler, cop kutusu, geri yukleme ve kalici silme
- Resim preview ve video stream
- Buyuk dosyalarda chunk upload / chunk download
- Tekli paylasim linkleri
- Coklu secim ile paylasim koleksiyonu olusturma
- Secili dosyalari ZIP olarak tek indirme
- Ayrı paylasim merkezi sayfasi

## Onemli Dosyalar

- `public/index.php`: API route'lari, auth middleware, download, preview, share ve ZIP endpoint'leri
- `src/Database.php`: tablo olusturma ve schema uyumlulugu
- `templates/index.html`: ana web dashboard
- `templates/shares.html`: paylasim merkezi
- `public/js/index.js`: dashboard state ve etkileşim mantigi
- `public/js/shares.js`: paylasim listeleri
- `public/css/index-dashboard.css`: dashboard tasarimi
- `public/css/shares.css`: paylasim merkezi tasarimi

## Web Dashboard

Web arayuzunde su akislar bulunur:

- dosya ve klasor arama
- favoriler ve cop kutusu modlari
- dosya kartlarindan hizli secim
- toplu tasima, toplu silme, toplu geri yukleme
- tek tek indirme ve ZIP indirme
- surukle birak ile klasore tasima
- dosya preview modal'i
- ayri paylasim merkezi ve koleksiyon sayfalari

## Kurulum

### Gereksinimler

- PHP 8.2+
- Composer
- MySQL veya MariaDB
- Telegram bot tokenlari

### Adimlar

1. Bagimliliklari kur:

```bash
composer install
```

2. `.env` dosyasini hazirla:

```ini
DB_HOST=localhost
DB_NAME=telegram_drive
DB_USER=root
DB_PASS=

TELEGRAM_BOT_TOKEN=bot_token_1,bot_token_2
TELEGRAM_CHAT_ID=your_chat_id

SECRET_KEY=your_random_secret_string
```

3. Gelistirme sunucusunu baslat:

```bash
php -S localhost:8000 -t public public/index.php
```

4. Tarayicida ac:

```text
http://localhost:8000
```

## Veritabani

Uygulama aktif akisinda MySQL kullanir. `Database::createTables()` her calismada eksik tablo veya kolonlari tamamlamaya calisir.

Olusan temel tablolar:

- `users`
- `folders`
- `files`
- `file_parts`
- `download_logs`
- `api_keys`
- `share_collections`
- `share_collection_files`

## ZIP Indirme Notu

- `ZipArchive` extension varsa dogrudan PHP uzerinden ZIP olusturulur.
- Extension yoksa Windows ortaminda PowerShell `Compress-Archive` fallback'i kullanilir.
- Bu sayede gelistirme ortami farkli olsa da toplu ZIP indirme akisi calismaya devam eder.

## API ve Kullanim

- API dokumani: `public/api/documentation.md`
- Web arayuzu: `/`
- Profil sayfasi: `/profile`
- Paylasim merkezi: `/shares`
- Public tekli paylasim: `/share/{token}`
- Public koleksiyon sayfasi: `/share/collection/{token}`

## Guvenlik

- JWT ile yetkili oturum
- API key destegi
- Telegram dosya URL'lerini dogrudan expose etmeyen proxy indirme akisi
- Kullaniciya gore dosya ve klasor filtreleme

## Notlar

- Buyuk dosyalarda preview kisitlanabilir.
- Chunked dosyalar indirme aninda backend tarafinda yeniden birlestirilir.
- Built-in PHP server ile CSS ve JS dosyalarinin dogru servis edilmesi icin router olarak `public/index.php` kullanilir.
