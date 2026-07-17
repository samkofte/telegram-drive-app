<?php

namespace App;

use PDO;
use PDOException;

class Database
{
    private static ?PDO $instance = null;

    private static function columnExists(PDO $db, string $table, string $column): bool
    {
        $stmt = $db->prepare("SHOW COLUMNS FROM `{$table}` LIKE ?");
        $stmt->execute([$column]);
        return $stmt->fetch() !== false;
    }

    private static function indexExists(PDO $db, string $table, string $index): bool
    {
        $stmt = $db->prepare("SHOW INDEX FROM `{$table}` WHERE Key_name = ?");
        $stmt->execute([$index]);
        return $stmt->fetch() !== false;
    }

    private static function foreignKeyExists(PDO $db, string $table, string $constraintName): bool
    {
        $stmt = $db->prepare("
            SELECT CONSTRAINT_NAME
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND CONSTRAINT_NAME = ?
              AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        ");
        $stmt->execute([$table, $constraintName]);
        return $stmt->fetch() !== false;
    }

    public static function getInstance(): PDO
    {
        if (self::$instance === null) {
            $host = $_ENV['DB_HOST'] ?? 'localhost';
            $port = $_ENV['DB_PORT'] ?? '3306';
            $dbName = $_ENV['DB_NAME'] ?? 'telegram';
            $user = $_ENV['DB_USER'] ?? 'root';
            $pass = $_ENV['DB_PASS'] ?? '';

            try {
                self::$instance = new PDO("mysql:host=$host;port=$port;dbname=$dbName", $user, $pass);
                self::$instance->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                self::$instance->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
                
                // MySQL specific charset
                self::$instance->exec("SET NAMES utf8mb4");
                self::$instance->exec("SET time_zone = '+00:00'");
            } catch (PDOException $e) {
                // If DB doesn't exist, try connecting without db name and creating it
                try {
                    $pdo = new PDO("mysql:host=$host;port=$port", $user, $pass);
                    $pdo->exec("CREATE DATABASE IF NOT EXISTS `$dbName` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
                    self::$instance = new PDO("mysql:host=$host;port=$port;dbname=$dbName", $user, $pass);
                    self::$instance->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                    self::$instance->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
                    self::$instance->exec("SET NAMES utf8mb4");
                    self::$instance->exec("SET time_zone = '+00:00'");
                } catch (PDOException $e2) {
                    throw new \Exception("Database connection failed: " . $e2->getMessage());
                }
            }
        }
        return self::$instance;
    }

    public static function createTables(): void
    {
        $db = self::getInstance();
        
        // Settings table
        $db->exec("CREATE TABLE IF NOT EXISTS settings (
            `key` VARCHAR(255) PRIMARY KEY,
            `value` TEXT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )");

        // Seed default settings if empty
        $stmt = $db->query("SELECT COUNT(*) FROM settings");
        if ($stmt->fetchColumn() == 0) {
            $defaultSettings = [
                'TELEGRAM_BOT_TOKEN' => '',
                'TELEGRAM_CHAT_ID' => '',
                'SECRET_KEY' => bin2hex(random_bytes(32)),
                'RESEND_API_KEY' => '',
                'TELEGRAM_BOT_UPLOAD_LIMIT' => (string)(19.5 * 1024 * 1024),
                'PUBLIC_SHARE_CHUNK_SIZE' => (string)(8 * 1024 * 1024),
                'OPENWA_API_URL' => 'http://localhost:2785',
                'OPENWA_API_KEY' => 'owa_k1_f51b837227a91edc1eb3543c0d3af055c3645e64e26f34fba9b4d67564fe926e'
            ];
            $insert = $db->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?)");
            foreach ($defaultSettings as $k => $v) {
                $insert->execute([$k, $v]);
            }
        } else {
            // Ensure new settings are seeded even if settings table is not empty
            $checkStmt = $db->prepare("SELECT COUNT(*) FROM settings WHERE `key` = ?");
            $checkStmt->execute(['OPENWA_API_URL']);
            if ($checkStmt->fetchColumn() == 0) {
                $insert = $db->prepare("INSERT INTO settings (`key`, `value`) VALUES (?, ?)");
                $insert->execute(['OPENWA_API_URL', 'http://localhost:2785']);
                $insert->execute(['OPENWA_API_KEY', 'owa_k1_f51b837227a91edc1eb3543c0d3af055c3645e64e26f34fba9b4d67564fe926e']);
            }
        }
        
        // Users table
        $db->exec("CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            telegram_id BIGINT UNIQUE,
            username VARCHAR(255),
            email VARCHAR(255) UNIQUE,
            password_hash VARCHAR(255),
            first_name VARCHAR(255),
            last_name VARCHAR(255),
            is_active TINYINT(1) DEFAULT 1,
            role VARCHAR(50) DEFAULT 'user',
            plan_type VARCHAR(50) DEFAULT 'free',
            plan_storage_limit BIGINT NULL DEFAULT NULL,
            plan_started_at TIMESTAMP NULL DEFAULT NULL,
            plan_expires_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )");

        $userColumns = [
            'plan_type' => "VARCHAR(50) DEFAULT 'free' AFTER role",
            'plan_storage_limit' => "BIGINT NULL DEFAULT NULL AFTER plan_type",
            'plan_started_at' => "TIMESTAMP NULL DEFAULT NULL AFTER plan_storage_limit",
            'plan_expires_at' => "TIMESTAMP NULL DEFAULT NULL AFTER plan_started_at",
        ];

        foreach ($userColumns as $columnName => $definition) {
            $columnExists = $db->query("SHOW COLUMNS FROM users LIKE '{$columnName}'")->fetch();
            if (!$columnExists) {
                $db->exec("ALTER TABLE users ADD COLUMN {$columnName} {$definition}");
            }
        }

        // Folders table
        $db->exec("CREATE TABLE IF NOT EXISTS folders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            color VARCHAR(7) DEFAULT '#3e577a',
            icon VARCHAR(64) DEFAULT 'folder',
            parent_id INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
        )");

        $folderColumns = [
            'color' => "VARCHAR(7) DEFAULT '#3e577a' AFTER name",
            'icon' => "VARCHAR(64) DEFAULT 'folder' AFTER color",
        ];

        foreach ($folderColumns as $columnName => $definition) {
            if (!self::columnExists($db, 'folders', $columnName)) {
                $db->exec("ALTER TABLE folders ADD COLUMN {$columnName} {$definition}");
            }
        }

        // Files table
        $db->exec("CREATE TABLE IF NOT EXISTS files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            telegram_file_id VARCHAR(255) UNIQUE NOT NULL,
            telegram_message_id BIGINT,
            file_name VARCHAR(500) NOT NULL,
            display_name VARCHAR(500),
            share_token VARCHAR(64) UNIQUE NULL,
            share_expires_at TIMESTAMP NULL DEFAULT NULL,
            file_size BIGINT NOT NULL,
            file_type VARCHAR(100),
            mime_type VARCHAR(255),
            file_path TEXT,
            telegram_url TEXT,
            uploaded_by BIGINT,
            user_id INT,
            is_public_upload TINYINT(1) DEFAULT 0,
            bot_token VARCHAR(255),
            folder_id INT DEFAULT NULL,
            is_favorite TINYINT(1) DEFAULT 0,
            is_downloaded TINYINT(1) DEFAULT 0,
            download_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        )");

        // Keep older databases in sync with the current schema so uploads do not fail
        // after Telegram succeeds but before the row is inserted into MySQL.
        $fileColumns = [
            'display_name' => "VARCHAR(500) NULL AFTER file_name",
            'share_token' => "VARCHAR(64) NULL AFTER display_name",
            'share_expires_at' => "TIMESTAMP NULL DEFAULT NULL AFTER share_token",
            'telegram_url' => "TEXT NULL AFTER file_path",
            'uploaded_by' => "BIGINT NULL AFTER telegram_url",
            'bot_token' => "VARCHAR(255) NULL AFTER user_id",
            'is_public_upload' => "TINYINT(1) DEFAULT 0 AFTER user_id",
            'upload_engine' => "VARCHAR(20) DEFAULT 'php' AFTER bot_token",
            'is_chunked' => "TINYINT(1) DEFAULT 0 AFTER upload_engine",
            'chunk_count' => "INT DEFAULT 1 AFTER is_chunked",
            'folder_id' => "INT DEFAULT NULL AFTER bot_token",
            'is_favorite' => "TINYINT(1) DEFAULT 0 AFTER folder_id",
            'deleted_at' => "TIMESTAMP NULL DEFAULT NULL AFTER updated_at",
        ];

        foreach ($fileColumns as $columnName => $definition) {
            if (!self::columnExists($db, 'files', $columnName)) {
                $db->exec("ALTER TABLE files ADD COLUMN {$columnName} {$definition}");
            }
        }

        if (!self::indexExists($db, 'files', 'idx_files_share_token')) {
            $db->exec("ALTER TABLE files ADD UNIQUE INDEX idx_files_share_token (share_token)");
        }

        if (!self::foreignKeyExists($db, 'files', 'files_ibfk_user_id')) {
            try {
                $db->exec("ALTER TABLE files ADD CONSTRAINT files_ibfk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL");
            } catch (PDOException $e) {
                // Ignore if the constraint already exists under a different auto-generated name.
            }
        }

        if (self::columnExists($db, 'files', 'folder_id') && !self::foreignKeyExists($db, 'files', 'files_ibfk_folder_id')) {
            try {
                $db->exec("ALTER TABLE files ADD CONSTRAINT files_ibfk_folder_id FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL");
            } catch (PDOException $e) {
                // Ignore if the constraint already exists under a different auto-generated name.
            }
        }

        $db->exec("CREATE TABLE IF NOT EXISTS file_parts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            file_id INT NOT NULL,
            part_index INT NOT NULL,
            telegram_file_id VARCHAR(255) NOT NULL,
            telegram_message_id BIGINT NULL,
            part_name VARCHAR(500) NULL,
            part_size BIGINT NOT NULL,
            mime_type VARCHAR(255) NULL,
            bot_token VARCHAR(255) NULL,
            telegram_url TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_file_part_index (file_id, part_index),
            KEY idx_file_parts_telegram_file_id (telegram_file_id),
            CONSTRAINT fk_file_parts_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        )");

        // Tags table
        $db->exec("CREATE TABLE IF NOT EXISTS tags (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            color VARCHAR(7) DEFAULT '#3e577a',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )");

        // File Tags table
        $db->exec("CREATE TABLE IF NOT EXISTS file_tags (
            file_id INT NOT NULL,
            tag_id INT NOT NULL,
            PRIMARY KEY (file_id, tag_id),
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )");

        // Download Logs table
        $db->exec("CREATE TABLE IF NOT EXISTS download_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            file_id INT NOT NULL,
            user_telegram_id BIGINT NOT NULL,
            download_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45),
            user_agent TEXT
        )");

        // API Keys table
        $db->exec("CREATE TABLE IF NOT EXISTS api_keys (
            id INT AUTO_INCREMENT PRIMARY KEY,
            key_name VARCHAR(255) NOT NULL,
            api_key VARCHAR(255) UNIQUE NOT NULL,
            user_telegram_id BIGINT NOT NULL,
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_used TIMESTAMP NULL DEFAULT NULL,
            expires_at TIMESTAMP NULL DEFAULT NULL
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS share_collections (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            share_token VARCHAR(64) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )");

        $db->exec("CREATE TABLE IF NOT EXISTS share_collection_files (
            collection_id INT NOT NULL,
            file_id INT NOT NULL,
            sort_order INT DEFAULT 0,
            PRIMARY KEY (collection_id, file_id),
            KEY idx_share_collection_order (collection_id, sort_order),
            FOREIGN KEY (collection_id) REFERENCES share_collections(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        )");
    }
}
