<?php
require __DIR__ . '/vendor/autoload.php';
use App\Database;

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
if (file_exists(__DIR__ . '/.env')) {
    $dotenv->load();
}

$db = Database::getInstance();
$email = 'tasmertsamet@gmail.com';

echo "Kullanıcı admin yapılıyor: $email\n";

$stmt = $db->prepare("UPDATE users SET role = 'admin' WHERE email = ?");
$stmt->execute([$email]);

if ($stmt->rowCount() > 0) {
    echo "Başarılı! Artık bu kullanıcıyla admin paneline girebilirsiniz.\n";
} else {
    echo "Hata: Kullanıcı bulunamadı veya zaten admin.\n";
}
