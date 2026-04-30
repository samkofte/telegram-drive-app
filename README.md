# Telegram Drive App

Bu depo, Telegram'i dosya depolama katmani olarak kullanan cok katmanli bir uygulama ailesini icerir. Proje; React Native tabanli mobil istemciyi, PHP tabanli API ve web surumunu, ayrica deneysel Python surumunu ayni repoda toplar.

## Genel Bakis

Projenin amaci kullanicilarin dosyalarini Telegram uzerine yukleyip uygulama icinden yonetebilmesi, goruntuleyebilmesi, paylasabilmesi ve indirebilmesidir.

Baslica yetenekler:

- Telegram uzerine dosya yukleme
- Dosya ve klasor listeleme
- Favori, cop kutusu ve paylasim akislari
- Uygulama icinde resim ve video onizleme
- Video stream oynatma
- Dosya gorunen adini uygulama icinde yeniden adlandirma
- Dashboard, son aktiviteler ve hizli islemler akislari
- JWT tabanli kimlik dogrulama

## Dizin Yapisi

### `native/project`

Expo + React Native ile gelistirilmis mobil istemci.

Onemli teknolojiler:

- Expo SDK 54
- Expo Router
- React Native 0.81
- Zustand
- Axios
- Expo Video
- Expo Image Picker / Document Picker

Onemli ekranlar:

- `app/(app)/dashboard.tsx`: Ana ekran, istatistikler, hizli islemler, son aktiviteler
- `app/(app)/files.tsx`: Dosya gezgini, arama, filtreler, onizleme, indirme, paylasma
- `app/(app)/upload.tsx`: Yukleme kuyrugu ve kaynak secimi
- `app/(app)/profile.tsx`: Profil ve ayarlar
- `app/(auth)/*`: Giris ve kayit akislari

### `php_version`

Slim Framework tabanli PHP backend ve web istemcisi.

Onemli teknolojiler:

- PHP 8+
- Slim Framework 4
- JWT
- PDO
- Guzzle

Baslica sorumluluklar:

- Kimlik dogrulama
- Dosya ve klasor API endpoint'leri
- Telegram bot entegrasyonu
- Stream, preview ve paylasim endpoint'leri
- Veritabani tablolari ve migration benzeri kurulum mantigi

### `python_version`

Python tarafinda alternatif / deneysel backend yapisi icin bulunan klasordur. Ana mobil akisin merkezinde su anda `php_version` yer alir.

### `.trae`

IDE ve gelistirme surecinde olusan belge ve yardimci dosyalar burada tutulur.

## Uygulama Mimarisi

Genel akis su sekildedir:

1. Mobil istemci dosya secimi yapar.
2. Istemci backend API'sine multipart upload gonderir.
3. PHP backend dosyayi Telegram botu uzerinden yukler.
4. Telegram cevabindan dosya kimligi ve mesaj bilgileri alinip veritabanina yazilir.
5. Mobil uygulama dosyalari `/files` benzeri endpoint'lerden tekrar ceker.
6. Onizleme ve video stream islemleri backend uzerinden yetkili sekilde sunulur.

## Desteklenen Akislar

### Mobil uygulama tarafinda

- Dashboard uzerinden hizli erisim
- Son aktiviteler kartindan ilgili dosyayi dogrudan acma
- Dosya listesinde arama
- Favorilere ekleme / cikarama
- Cop kutusuna tasima / geri alma
- Dosya indirme
- Paylasim linki olusturma
- Video onizleme ve stream
- Uygulama icinde dosya gorunen adini guncelleme

### Backend tarafinda

- Kullanici bazli dosya filtreleme
- Favori ve cop kutusu durum yonetimi
- `display_name` ve `file_name` ayrimi
- Video ve document payload'larini ayri ayri ele alma
- Eski veritabani semalari icin eksik kolonlari tamamlama mantigi

## Kurulum

## 1. Mobil Uygulama

Klasor:

```bash
cd native/project
```

Bagimliliklar:

```bash
npm install
```

Gelistirme sunucusu:

```bash
npx expo start
```

Kisa scriptler:

```bash
npm run android
npm run ios
npm run web
npm run lint
```

## 2. PHP Backend

Klasor:

```bash
cd php_version
```

Composer bagimliliklari:

```bash
composer install
```

Ornek gelistirme calistirma:

```bash
php -S localhost:8000 -t public
```

Not:

- Proje veritabani olarak yerel dosya / SQL tabanli yapi kullaniyor olabilir.
- Telegram bot bilgileri, veritabani ayarlari ve secret key degerleri ortam ayarlarina gore duzenlenmelidir.

## Onemli Notlar

- Mobil istemci ile backend arasindaki API tabani `native/project/constants/Config.ts` icinden yonetilir.
- Video oynatma tarafinda `expo-video` kullanilir.
- Dosya yeniden adlandirma isleminde gercek dosya adi korunur, uygulama icinde gorunen ad `display_name` olarak kullanilir.
- Arama ve listeleme akislarinda `display_name` desteklenir.
- Geri navigasyon davranisi son gelinen ekran mantigina gore iyilestirilmistir.

## Gelistirme Notlari

Projede son donemde su alanlarda iyilestirmeler yapildi:

- Video yukleme cevabinda `video` payload destegi
- Veritabani uyumlulugu icin eksik kolonlari tamamlama
- Son aktivitelerden dosya preview acilisi
- Video onizleme deneyimi
- `expo-av` yerine `expo-video` gecisi
- Dosya yeniden adlandirma akisi
- Upload ve files ekranlarinda daha dogal geri donus davranisi

## Depoya Dahil Icerikler

Bu repoda sadece mobil kaynak kodu degil, ayni zamanda:

- PHP backend
- Python alternatif denemeleri
- Tasarim referanslari
- Gelistirme notlari
- Yerel veritabani dosyalari

da yer alabilir.

## Onerilen Sonraki Adimlar

- Koke `.gitignore` eklenmesi
- Ortam degiskenlerinin standardize edilmesi
- Tek bir merkezi kurulum rehberi olusturulmasi
- Mobil ve backend icin ayri release notlari tutulmasi

## Lisans

Bu depo icin acik bir lisans tanimi henuz eklenmemisse, dagitim oncesinde lisans dosyasi eklenmesi onerilir.
