#!/usr/bin/env python3
"""
Telegram Dosya Yöneticisi Başlatma Scripti
"""

import os
import sys
import subprocess
from pathlib import Path

def check_python_version():
    """Python versiyonunu kontrol et"""
    if sys.version_info < (3, 8):
        print("❌ Python 3.8 veya üstü gerekli!")
        print(f"   Mevcut versiyon: {sys.version}")
        return False
    print(f"✅ Python versiyonu uygun: {sys.version.split()[0]}")
    return True

def check_requirements():
    """Gerekli dosyaları kontrol et"""
    required_files = ['main.py', 'requirements.txt']
    missing_files = []
    
    for file in required_files:
        if not Path(file).exists():
            missing_files.append(file)
    
    if missing_files:
        print(f"❌ Eksik dosyalar: {', '.join(missing_files)}")
        return False
    
    print("✅ Gerekli dosyalar mevcut")
    return True

def check_env_file():
    """Çevre değişkenleri dosyasını kontrol et"""
    print("✅ Konfigürasyon doğrudan kodda yapıldı")
    return True

def install_requirements():
    """Gerekli paketleri yükle"""
    print("📦 Gerekli paketler yükleniyor...")
    
    try:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'])
        print("✅ Paketler başarıyla yüklendi")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Paket yükleme hatası: {e}")
        return False

def check_telegram_config():
    """Telegram yapılandırmasını kontrol et"""
    # main.py'den konfigürasyonu kontrol et
    import main
    
    if not main.TELEGRAM_BOT_TOKEN or main.TELEGRAM_BOT_TOKEN == 'your_telegram_bot_token_here':
        print("❌ TELEGRAM_BOT_TOKEN yapılandırılmamış!")
        print("   main.py dosyasında bot token'ınızı ayarlayın.")
        return False
    
    if not main.TELEGRAM_CHAT_ID or main.TELEGRAM_CHAT_ID == 'your_chat_id_here':
        print("❌ TELEGRAM_CHAT_ID yapılandırılmamış!")
        print("   main.py dosyasında chat ID'nizi ayarlayın.")
        return False
    
    print("✅ Telegram yapılandırması tamam")
    return True

def create_upload_dir():
    """Upload dizinini oluştur"""
    upload_dir = Path('uploads')
    upload_dir.mkdir(exist_ok=True)
    print("✅ Upload dizini hazır")

def start_server():
    """Sunucuyu başlat"""
    print("\n🚀 Telegram Dosya Yöneticisi başlatılıyor...")
    print("   Web arayüzü: http://localhost:8000")
    print("   API dokümantasyonu: http://localhost:8000/docs")
    print("   Durdurmak için Ctrl+C tuşlayın\n")
    
    try:
        subprocess.run([sys.executable, 'main.py'])
    except KeyboardInterrupt:
        print("\n👋 Uygulama durduruldu")

def main():
    """Ana fonksiyon"""
    print("=" * 50)
    print("📁 Telegram Dosya Yöneticisi")
    print("=" * 50)
    
    # Kontroller
    if not check_python_version():
        sys.exit(1)
    
    if not check_requirements():
        sys.exit(1)
    
    if not check_env_file():
        print("\n📝 Kurulum adımları:")
        print("1. env_example.txt dosyasını .env olarak kopyalayın")
        print("2. .env dosyasını düzenleyin ve Telegram bilgilerinizi girin")
        print("3. Bu scripti tekrar çalıştırın")
        sys.exit(1)
    
    if not check_telegram_config():
        sys.exit(1)
    
    # Kurulum
    if not install_requirements():
        sys.exit(1)
    
    create_upload_dir()
    
    # Sunucuyu başlat
    start_server()

if __name__ == "__main__":
    main() 