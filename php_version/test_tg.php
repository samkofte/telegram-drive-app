<?php
require __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
if (file_exists(__DIR__ . '/.env')) { $dotenv->load(); }

$tokens = array_filter(array_map('trim', explode(',', $_ENV['TELEGRAM_BOT_TOKEN'])));
$chatId = $_ENV['TELEGRAM_CHAT_ID'];

echo "--- Telegram Connection Test ---\n";
echo "Chat ID: $chatId\n\n";

foreach ($tokens as $index => $token) {
    echo "Testing Bot #" . ($index + 1) . "... ";
    $url = "https://api.telegram.org/bot$token/sendMessage";
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
        'chat_id' => $chatId,
        'text' => "✅ Test Mesajı - Bot #" . ($index + 1) . " aktif!"
    ]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    
    $response = json_decode(curl_exec($ch), true);
    curl_close($ch);

    if ($response && $response['ok']) {
        echo "BAŞARILI! ✅\n";
    } else {
        echo "HATA! ❌ -> " . ($response['description'] ?? 'Bağlantı kurulamadı') . "\n";
    }
}
echo "\nTest bitti. Eğer hata alıyorsanız .env dosyasını ve botu başlatıp başlatmadığınızı kontrol edin.\n";
