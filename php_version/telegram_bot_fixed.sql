-- Full Telegram Bot MySQL Recovery Dump
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Structure for users
DROP TABLE IF EXISTS `users`;
CREATE TABLE IF NOT EXISTS users (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data for users

-- Structure for files
DROP TABLE IF EXISTS `files`;
CREATE TABLE IF NOT EXISTS files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            telegram_file_id VARCHAR(255) UNIQUE NOT NULL,
            telegram_message_id BIGINT,
            file_name VARCHAR(500) NOT NULL,
            display_name VARCHAR(500),
            file_size BIGINT NOT NULL,
            file_type VARCHAR(100),
            mime_type VARCHAR(255),
            file_path TEXT,
            telegram_url TEXT,
            uploaded_by BIGINT,
            user_id INT,
            is_downloaded TINYINT(1) DEFAULT 0,
            download_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data for files

-- Structure for download_logs
DROP TABLE IF EXISTS `download_logs`;
CREATE TABLE IF NOT EXISTS download_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            file_id INT NOT NULL,
            user_telegram_id BIGINT NOT NULL,
            download_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45),
            user_agent TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data for download_logs

-- Structure for api_keys
DROP TABLE IF EXISTS `api_keys`;
CREATE TABLE IF NOT EXISTS api_keys (
            id INT AUTO_INCREMENT PRIMARY KEY,
            key_name VARCHAR(255) NOT NULL,
            api_key VARCHAR(255) UNIQUE NOT NULL,
            user_telegram_id BIGINT NOT NULL,
            is_active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_used TIMESTAMP NULL DEFAULT NULL,
            expires_at TIMESTAMP NULL DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data for api_keys

-- Structure for system_config
DROP TABLE IF EXISTS `system_config`;
CREATE TABLE IF NOT EXISTS system_config (
            config_key VARCHAR(255) PRIMARY KEY,
            config_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
