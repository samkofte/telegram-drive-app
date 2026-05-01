<?php
require __DIR__ . '/vendor/autoload.php';
use App\Database;
use App\Services\AuthService;

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
if (file_exists(__DIR__ . '/.env')) {
    $dotenv->load();
}

$db = Database::getInstance();
$authService = new AuthService($_ENV['SECRET_KEY'] ?? 'your-secret-key-here-change-in-production');

// Test kullanıcısı bilgileri
$email = 'test@test.com';
$password = 'test123';
$username = 'testuser';
$firstName = 'Test';
$lastName = 'User';

echo "Test kullanıcısı oluşturuluyor...\n";
echo "Email: $email\n";
echo "Password: $password\n";
echo "Username: $username\n\n";

// Önce var mı kontrol et
$stmt = $db->prepare("SELECT id FROM users WHERE email = ?");
$stmt->execute([$email]);
if ($stmt->fetch()) {
    echo "Bu email zaten kayıtlı. Şifre güncelleniyor...\n";
    $hash = $authService->hashPassword($password);
    $stmt = $db->prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE email = ?");
    $stmt->execute([$hash, $email]);
    echo "Şifre güncellendi!\n";
} else {
    // Yeni kullanıcı oluştur
    $hash = $authService->hashPassword($password);
    $stmt = $db->prepare("INSERT INTO users (email, username, password_hash, first_name, last_name, role, is_active) VALUES (?, ?, ?, ?, ?, 'user', 1)");
    $stmt->execute([$email, $username, $hash, $firstName, $lastName]);
    echo "Yeni kullanıcı oluşturuldu!\n";
}

echo "\nGiriş bilgileri:\n";
echo "Email: $email\n";
echo "Password: $password\n";
