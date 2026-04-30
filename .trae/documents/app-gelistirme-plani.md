# Uygulama Gelistirme Plani

## 1. Kisa Vade
- Alt navbar gecislerini daha da hizlandir ve secili sekme animasyonunu ekle.
- `Files` ekraninda toplu secim, coklu silme ve coklu tasima islemlerini tamamla.
- Upload akisina gercek yuzdelik progress ve iptal etme destegi ekle.
- Hata, basari ve bilgi mesajlarini ortak bir toast sistemi altinda birlestir.

## 2. Orta Vade
- `Recent Files`, `Favorites` ve `Trash` icin offline cache yapisi ekle.
- Dosya detay ekranini ayri route olarak ayir ve yorum/not alanlari ekle.
- Gelismis arama filtreleri ekle:
  - dosya tipi
  - tarih araligi
  - boyut araligi
  - etiket
- Klasorler icin renk, ikon ve sabitleme destegi ekle.

## 3. Uzun Vade
- Gercek tema sistemi kur:
  - light
  - dark
  - system
- Bildirim merkezi ve upload/download gecmisini ekle.
- Admin paneline loglar, kota takibi ve kullanici bazli raporlar ekle.
- Paylasim linkleri icin son kullanma tarihi ve sifre korumasi ekle.

## 4. Teknik Iyilestirmeler
- Ortak `UI primitives` klasoru olustur ve buton, kart, modal, toast bilesenlerini merkezilestir.
- API response tiplerini netlestir ve `any` kullanimlarini azalt.
- Dosya listeleme, upload ve auth akislarina test ekle.
- PHP backend icin paylasim, favori, trash ve upload endpointlerine entegrasyon testi yaz.

## 5. Teslim Kriterleri
- Kullanici favori, trash, paylas ve indirme islemlerini tek tikla yapabilmeli.
- Upload akisinda kaynak secimi, ilerleme durumu ve sonuc mesaji net gorunmeli.
- Dashboard verileri manuel yenileme gerektirmeden tutarli guncellenmeli.
- Tema ayari kalici olmali ve ana ekranlarda tutarli gorunmeli.
