<?php
require 'vendor/autoload.php';

use App\Database;
use Dotenv\Dotenv;

// Load .env if it exists
if (file_exists(__DIR__ . '/.env')) {
    $dotenv = Dotenv::createImmutable(__DIR__);
    $dotenv->load();
}

// Ensure Database class is loaded. Since we are using autoload, verify if src/Database.php is needed explicitly 
// or if composer autoload handles it. The original file required 'src/Database.php'.
// If vendor/autoload.php exists, we should use it. If not, we might need manual require.
if (!class_exists('App\Database')) {
    require 'src/Database.php';
}

echo "Starting database schema update...\n";

// Get PDO instance
$db = Database::getInstance();

// 1. Create 'folders' table
// Note: Using MySQL syntax now since Database.php seems to default to MySQL
// But wait, the previous update_db.py used SQLite. 
// Let's check if the project is using MySQL or SQLite.
// Database.php uses mysql:host... so it expects MySQL.
// My python script used sqlite3 on 'telegram_bot.db'.
// This is a conflict. The user asked to use 'php_version' as API.
// If php_version uses MySQL (as seen in Database.php), then my Python script updating a local SQLite file was WRONG/Ineffective for the PHP app if the PHP app connects to MySQL.
// HOWEVER, looking at the directory structure earlier, I saw 'telegram_bot.db' in php_version folder.
// Let's check if .env exists and what it says. 
// If Database.php is hardcoded to MySQL, then the SQLite file is useless for PHP.

// Let's look at Database.php again. It tries to connect to MySQL.
// Line 22: new PDO("mysql:host=$host..."
// So the PHP app IS using MySQL.
// My previous Python script updated a SQLite file 'telegram_bot.db'.
// This means the PHP app does NOT see those changes if it uses MySQL.

// I must update the MySQL database using this PHP script.

$db->exec("CREATE TABLE IF NOT EXISTS folders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
)");
echo "Table 'folders' checked/created.\n";

// 2. Create 'tags' table
$db->exec("CREATE TABLE IF NOT EXISTS tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) DEFAULT '#3e577a',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)");
echo "Table 'tags' checked/created.\n";

// 3. Create 'file_tags' table
$db->exec("CREATE TABLE IF NOT EXISTS file_tags (
    file_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (file_id, tag_id),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
)");
echo "Table 'file_tags' checked/created.\n";

// 4. Add columns to 'files' table
$columnsToAdd = [
    'folder_id' => 'INT DEFAULT NULL', // Foreign key constraint added later to avoid issues if exists
    'is_favorite' => 'TINYINT(1) DEFAULT 0',
    'deleted_at' => 'TIMESTAMP NULL DEFAULT NULL'
];

// Helper to check if column exists
function columnExists($db, $table, $column) {
    $stmt = $db->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
    $stmt->execute([$column]);
    return $stmt->fetch() !== false;
}

foreach ($columnsToAdd as $colName => $colDef) {
    if (!columnExists($db, 'files', $colName)) {
        try {
            $db->exec("ALTER TABLE files ADD COLUMN $colName $colDef");
            echo "Added column '$colName' to 'files' table.\n";
            
            if ($colName === 'folder_id') {
                $db->exec("ALTER TABLE files ADD CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL");
                echo "Added FK constraint for folder_id.\n";
            }
        } catch (PDOException $e) {
            echo "Error adding column '$colName': " . $e->getMessage() . "\n";
        }
    } else {
        echo "Column '$colName' already exists in 'files' table.\n";
    }
}

// 5. Add plan columns to 'users' table
$userColumnsToAdd = [
    'plan_type' => "VARCHAR(50) DEFAULT 'free'",
    'plan_storage_limit' => 'BIGINT NULL DEFAULT NULL',
    'plan_started_at' => 'TIMESTAMP NULL DEFAULT NULL',
    'plan_expires_at' => 'TIMESTAMP NULL DEFAULT NULL',
];

foreach ($userColumnsToAdd as $colName => $colDef) {
    if (!columnExists($db, 'users', $colName)) {
        try {
            $db->exec("ALTER TABLE users ADD COLUMN $colName $colDef");
            echo "Added column '$colName' to 'users' table.\n";
        } catch (PDOException $e) {
            echo "Error adding column '$colName': " . $e->getMessage() . "\n";
        }
    } else {
        echo "Column '$colName' already exists in 'users' table.\n";
    }
}

echo "Database schema update completed.\n";
