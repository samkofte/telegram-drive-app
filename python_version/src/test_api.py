#!/usr/bin/env python3
"""
Telegram Dosya Yöneticisi API Test Scripti
"""

import requests
import json
import os
from pathlib import Path

# API base URL
BASE_URL = "http://localhost:8001"

def test_health_check():
    """Sağlık kontrolü testi"""
    print("🔍 Sağlık kontrolü testi...")
    
    try:
        response = requests.get(f"{BASE_URL}/health")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Sağlık kontrolü başarılı")
            print(f"   Bot yapılandırılmış: {data.get('bot_configured', False)}")
            print(f"   Chat ID yapılandırılmış: {data.get('chat_id_configured', False)}")
            print(f"   Yüklenen dosya sayısı: {data.get('uploaded_files_count', 0)}")
            return True
        else:
            print(f"❌ Sağlık kontrolü başarısız: {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ Sunucuya bağlanılamıyor. Sunucunun çalıştığından emin olun.")
        return False

def test_list_files():
    """Dosya listeleme testi"""
    print("\n📋 Dosya listeleme testi...")
    
    try:
        response = requests.get(f"{BASE_URL}/files")
        if response.status_code == 200:
            files = response.json()
            print(f"✅ Dosya listesi alındı: {len(files)} dosya")
            for file in files:
                print(f"   📁 {file['filename']} ({file['file_size']} bytes)")
            return files
        else:
            print(f"❌ Dosya listesi alınamadı: {response.status_code}")
            return []
    except Exception as e:
        print(f"❌ Dosya listesi hatası: {e}")
        return []

def test_upload_file():
    """Dosya yükleme testi"""
    print("\n📤 Dosya yükleme testi...")
    
    # Test dosyası oluştur
    test_file_path = "test_file.txt"
    test_content = "Bu bir test dosyasıdır.\nTelegram Dosya Yöneticisi API testi için oluşturulmuştur."
    
    try:
        with open(test_file_path, 'w', encoding='utf-8') as f:
            f.write(test_content)
        
        # Dosyayı yükle
        with open(test_file_path, 'rb') as f:
            files = {'file': f}
            response = requests.post(f"{BASE_URL}/upload", files=files)
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print(f"✅ Dosya başarıyla yüklendi: {result['file_info']['filename']}")
                return result['file_info']['file_id']
            else:
                print(f"❌ Dosya yükleme başarısız: {result.get('message', 'Bilinmeyen hata')}")
                return None
        else:
            print(f"❌ Dosya yükleme hatası: {response.status_code}")
            return None
            
    except Exception as e:
        print(f"❌ Dosya yükleme hatası: {e}")
        return None
    finally:
        # Test dosyasını temizle
        if os.path.exists(test_file_path):
            os.remove(test_file_path)

def test_download_file(file_id):
    """Dosya indirme testi"""
    if not file_id:
        print("❌ İndirme testi için file_id gerekli")
        return False
    
    print(f"\n📥 Dosya indirme testi (ID: {file_id})...")
    
    try:
        response = requests.get(f"{BASE_URL}/download/{file_id}")
        if response.status_code == 200:
            # Dosyayı kaydet
            download_path = f"downloaded_test_file_{file_id}.txt"
            with open(download_path, 'wb') as f:
                f.write(response.content)
            
            print(f"✅ Dosya başarıyla indirildi: {download_path}")
            
            # İndirilen dosyayı temizle
            os.remove(download_path)
            return True
        else:
            print(f"❌ Dosya indirme hatası: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Dosya indirme hatası: {e}")
        return False

def test_delete_file(file_id):
    """Dosya silme testi"""
    if not file_id:
        print("❌ Silme testi için file_id gerekli")
        return False
    
    print(f"\n🗑️ Dosya silme testi (ID: {file_id})...")
    
    try:
        response = requests.delete(f"{BASE_URL}/files/{file_id}")
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                print("✅ Dosya başarıyla silindi")
                return True
            else:
                print(f"❌ Dosya silme başarısız: {result.get('message', 'Bilinmeyen hata')}")
                return False
        else:
            print(f"❌ Dosya silme hatası: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Dosya silme hatası: {e}")
        return False

def main():
    """Ana test fonksiyonu"""
    print("=" * 60)
    print("🧪 Telegram Dosya Yöneticisi API Testi")
    print("=" * 60)
    
    # Sağlık kontrolü
    if not test_health_check():
        print("\n❌ Sunucu çalışmıyor veya yapılandırılmamış!")
        print("   Lütfen sunucuyu başlatın ve yapılandırmayı kontrol edin.")
        return
    
    # Mevcut dosyaları listele
    initial_files = test_list_files()
    
    # Dosya yükle
    uploaded_file_id = test_upload_file()
    
    # Dosyaları tekrar listele
    updated_files = test_list_files()
    
    # Dosya indir (eğer yükleme başarılıysa)
    if uploaded_file_id:
        test_download_file(uploaded_file_id)
        
        # Dosya sil
        test_delete_file(uploaded_file_id)
        
        # Son durumu kontrol et
        final_files = test_list_files()
    
    print("\n" + "=" * 60)
    print("✅ API testi tamamlandı!")
    print("=" * 60)

if __name__ == "__main__":
    main() 