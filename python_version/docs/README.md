# 🚀 Telegram Drive API Bot

> **Modern ve Güçlü Dosya Yönetim Sistemi**  
> Telegram Bot API kullanarak dosya yükleme, indirme ve **video streaming** özelliklerini sunan web uygulaması.

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)](https://fastapi.tiangolo.com)
[![Telegram Bot](https://img.shields.io/badge/Telegram%20Bot-API-blue.svg)](https://core.telegram.org/bots/api)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Özellikler

### 🎥 Video Streaming
- **📺 İndirmeden İzleme**: Video dosyalarını tamamen indirmeden tarayıcıda oynatın
- **⚡ Range Request Desteği**: HTTP Range request'leri ile verimli video streaming
- **🎮 Klavye Kısayolları**: Space, ok tuşları ile video kontrolü
- **💾 Otomatik Pozisyon Hatırlama**: Kaldığınız yerden devam edin
- **📱 Responsive Tasarım**: Mobil ve masaüstü uyumlu

### 📁 Dosya Yönetimi
- **📤 Kolay Yükleme**: Sürükle-bırak ile dosya yükleme
- **📥 Hızlı İndirme**: Tek tıkla dosya indirme
- **🗑️ Güvenli Silme**: Dosyaları Telegram'dan da silme
- **🔍 Detaylı Bilgi**: Dosya boyutu, türü, yükleme tarihi
- **🎯 Video Önizleme**: Video dosyaları için küçük oynatıcı

### 🛡️ Güvenlik ve Performans
- **🔐 Telegram Güvenliği**: Dosyalar Telegram sunucularında saklanır
- **⚡ Hızlı Erişim**: CDN üzerinden hızlı dosya erişimi
- **💾 Bellek Optimizasyonu**: Yerel disk kullanımı yok
- **🔄 Asenkron İşlemler**: Yüksek performans için async/await

---

## 🚀 Hızlı Başlangıç

### 📋 Gereksinimler
```bash
Python 3.8+
pip install fastapi uvicorn python-telegram-bot
```

### ⚙️ Kurulum

1. **Repository'yi klonlayın**
   ```bash
   git clone https://github.com/samkofte/telegramdriveapi_bot.git
   cd telegramdriveapi_bot
   ```

2. **Bağımlılıkları yükleyin**
   ```bash
   pip install -r requirements.txt
   ```

3. **Telegram Bot ayarlarını yapın**
   ```python
   # main.py dosyasında
   TELEGRAM_BOT_TOKEN = "your_bot_token_here"
   TELEGRAM_CHAT_ID = "your_chat_id_here"
   ```

4. **Uygulamayı çalıştırın**
   ```bash
   python main.py
   ```

5. **Tarayıcıda açın**
   ```
   http://localhost:8001
   ```

---

## 🎮 Kullanım

### 📤 Dosya Yükleme
1. Ana sayfada dosya seçin veya sürükleyin
2. "📤 Yükle" butonuna tıklayın
3. Yükleme tamamlandığında dosya listesinde görünecek

### 🎥 Video İzleme
1. Video dosyasını yükleyin
2. "▶️ İzle" butonuna tıklayın
3. Tam ekran video oynatıcı açılacak

### 📥 Dosya İndirme
1. Herhangi bir dosyanın "📥 İndir" butonuna tıklayın
2. Dosya otomatik olarak indirilmeye başlayacak

### 🗑️ Dosya Silme
1. "🗑️ Sil" butonuna tıklayın
2. Onay verin
3. Dosya hem listeden hem Telegram'dan silinecek

---

## 🎮 Video Oynatıcı Kısayolları

| Tuş | İşlev |
|-----|-------|
| `Space` | Oynat/Duraklat |
| `→` | 10 saniye ileri |
| `←` | 10 saniye geri |
| `↑` | Ses seviyesini artır |
| `↓` | Ses seviyesini azalt |
| `F` | Tam ekran |
| `M` | Sesi kapat/aç |

---

## 🔧 API Endpoints

### 📁 Dosya İşlemleri
| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/` | GET | Ana sayfa |
| `/upload` | POST | Dosya yükleme |
| `/files` | GET | Dosya listesi |
| `/download/{file_id}` | GET | Dosya indirme |
| `/files/{file_id}` | DELETE | Dosya silme |

### 🎥 Video Streaming
| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/stream/{file_id}` | GET | Video streaming |
| `/player/{file_id}` | GET | Video oynatıcı sayfası |
| `/telegram-url/{file_id}` | GET | Telegram dosya URL'i |

### 🔍 Sistem
| Endpoint | Method | Açıklama |
|----------|--------|----------|
| `/health` | GET | Sistem durumu |

---

## 📊 Desteklenen Dosya Türleri

### 🎥 Video Dosyaları
- MP4, AVI, MKV, MOV, WMV, FLV
- WebM, 3GP, M4V, TS, MTS

### 🖼️ Resim Dosyaları
- JPG, JPEG, PNG, GIF, BMP
- TIFF, SVG, WebP, ICO

### 📄 Doküman Dosyaları
- PDF, DOC, DOCX, XLS, XLSX
- PPT, PPTX, TXT, RTF, CSV

### 📦 Arşiv Dosyaları
- ZIP, RAR, 7Z, TAR, GZ
- BZ2, XZ, LZMA

### 🎵 Ses Dosyaları
- MP3, WAV, FLAC, AAC, OGG
- WMA, M4A, AIFF

### 🌐 Web Dosyaları
- HTML, CSS, JS, JSON, XML
- TORRENT, ISO, EXE

---

## 🛠️ Teknik Detaylar

### 🏗️ Mimari
- **Backend**: FastAPI (Python)
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Storage**: Telegram Bot API
- **Streaming**: HTTP Range Requests
- **Authentication**: Telegram Bot Token

### 📈 Performans
- **Maksimum Dosya Boyutu**: 100MB
- **Eşzamanlı İstekler**: Sınırsız
- **Video Streaming**: Range request desteği
- **Bellek Kullanımı**: Minimum (yerel disk yok)

### 🔒 Güvenlik
- **Dosya Doğrulama**: MIME type kontrolü
- **Boyut Limiti**: Maksimum dosya boyutu kontrolü
- **Telegram Güvenliği**: Dosyalar Telegram sunucularında
- **CORS**: Cross-origin request desteği

---

## 🐛 Sorun Giderme

### ❌ Video Oynatılmıyor
1. Dosya türünün video olduğundan emin olun
2. Tarayıcınızın video codec desteğini kontrol edin
3. İnternet bağlantınızı kontrol edin

### ❌ Dosya Yüklenmiyor
1. Dosya boyutunun 100MB altında olduğundan emin olun
2. Telegram bot token'ınızı kontrol edin
3. Chat ID'nizi kontrol edin

### ❌ İndirme Çalışmıyor
1. Dosyanın Telegram'da mevcut olduğundan emin olun
2. Tarayıcınızın popup engelleyicisini kontrol edin
3. İnternet bağlantınızı kontrol edin

---

## 🤝 Katkıda Bulunma

1. Fork yapın
2. Feature branch oluşturun (`git checkout -b feature/AmazingFeature`)
3. Commit yapın (`git commit -m 'Add some AmazingFeature'`)
4. Push yapın (`git push origin feature/AmazingFeature`)
5. Pull Request açın

---

## 📄 Lisans

Bu proje MIT lisansı altında lisanslanmıştır. Detaylar için [LICENSE](LICENSE) dosyasına bakın.

---

## 👨‍💻 Geliştirici

**Sam Kofte** - [GitHub](https://github.com/samkofte)

---

## ⭐ Yıldız Verin

Bu projeyi beğendiyseniz ⭐ yıldız vermeyi unutmayın!

---

<div align="center">

**Made with ❤️ by Sam Kofte**

[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/samkofte)
[![Telegram](https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/samkofte)

</div>