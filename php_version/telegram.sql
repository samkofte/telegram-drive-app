-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Anamakine: localhost:3306
-- Üretim Zamanı: 30 Nis 2026, 22:58:11
-- Sunucu sürümü: 8.4.3
-- PHP Sürümü: 8.3.28

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Veritabanı: `telegram`
--

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `api_keys`
--

CREATE TABLE `api_keys` (
  `id` int NOT NULL,
  `key_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_telegram_id` bigint NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Tablo döküm verisi `api_keys`
--

INSERT INTO `api_keys` (`id`, `key_name`, `api_key`, `user_telegram_id`, `is_active`, `created_at`, `last_used`, `expires_at`) VALUES
(1, 'benim', 'sk_4e25681d1ba80c2ed4b9d7907feedc1ee9ec25e85fbcaafb', 0, 1, '2026-01-19 16:28:44', NULL, NULL);

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `download_logs`
--

CREATE TABLE `download_logs` (
  `id` int NOT NULL,
  `file_id` int NOT NULL,
  `user_telegram_id` bigint NOT NULL,
  `download_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Tablo döküm verisi `download_logs`
--

INSERT INTO `download_logs` (`id`, `file_id`, `user_telegram_id`, `download_time`, `ip_address`, `user_agent`) VALUES
(1, 1, 0, '2026-01-19 13:09:49', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(2, 2, 0, '2026-01-19 13:09:55', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(3, 3, 0, '2026-01-19 13:24:23', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(4, 8, 0, '2026-01-19 13:25:31', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(5, 7, 0, '2026-01-19 13:25:35', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(6, 11, 0, '2026-01-19 13:41:39', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(7, 12, 0, '2026-01-19 13:41:42', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(8, 6, 0, '2026-01-19 13:41:44', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(9, 14, 0, '2026-01-19 13:51:40', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(10, 14, 0, '2026-01-19 16:33:35', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(11, 15, 0, '2026-01-21 18:50:46', '127.0.0.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'),
(12, 18, 0, '2026-04-30 20:16:22', '192.168.1.103', 'Expo/1017756 CFNetwork/3860.400.51 Darwin/25.3.0'),
(13, 18, 0, '2026-04-30 20:44:25', '192.168.1.103', 'Expo/1017756 CFNetwork/3860.400.51 Darwin/25.3.0'),
(14, 21, 0, '2026-04-30 22:09:21', '192.168.1.103', 'Expo/1017756 CFNetwork/3860.400.51 Darwin/25.3.0'),
(15, 21, 0, '2026-04-30 22:29:27', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(16, 21, 0, '2026-04-30 22:29:28', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(17, 21, 0, '2026-04-30 22:29:35', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(18, 21, 0, '2026-04-30 22:29:36', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(19, 21, 0, '2026-04-30 22:29:36', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(20, 21, 0, '2026-04-30 22:29:37', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(21, 21, 0, '2026-04-30 22:29:39', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(22, 21, 0, '2026-04-30 22:29:39', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(23, 21, 0, '2026-04-30 22:29:40', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(24, 21, 0, '2026-04-30 22:34:57', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(25, 21, 0, '2026-04-30 22:34:59', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(26, 21, 0, '2026-04-30 22:42:29', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(27, 21, 0, '2026-04-30 22:42:30', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(28, 21, 0, '2026-04-30 22:42:54', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(29, 21, 0, '2026-04-30 22:42:55', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(30, 21, 0, '2026-04-30 22:46:42', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(31, 21, 0, '2026-04-30 22:46:43', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(32, 21, 0, '2026-04-30 22:50:42', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(33, 21, 0, '2026-04-30 22:50:43', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(34, 21, 0, '2026-04-30 22:50:49', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(35, 21, 0, '2026-04-30 22:50:51', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(36, 21, 0, '2026-04-30 22:51:09', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(37, 21, 0, '2026-04-30 22:51:10', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(38, 21, 0, '2026-04-30 22:51:16', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)'),
(39, 21, 0, '2026-04-30 22:51:17', '192.168.1.103', 'AppleCoreMedia/1.0.0.23D8133 (iPhone; U; CPU OS 26_3_1 like Mac OS X; tr_tr)');

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `files`
--

CREATE TABLE `files` (
  `id` int NOT NULL,
  `telegram_file_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `telegram_message_id` bigint DEFAULT NULL,
  `file_name` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `share_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` bigint NOT NULL,
  `file_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mime_type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_path` text COLLATE utf8mb4_unicode_ci,
  `telegram_url` text COLLATE utf8mb4_unicode_ci,
  `uploaded_by` bigint DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `bot_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_downloaded` tinyint(1) DEFAULT '0',
  `download_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `folder_id` int DEFAULT NULL,
  `is_favorite` tinyint(1) DEFAULT '0',
  `deleted_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Tablo döküm verisi `files`
--

INSERT INTO `files` (`id`, `telegram_file_id`, `telegram_message_id`, `file_name`, `display_name`, `share_token`, `file_size`, `file_type`, `mime_type`, `file_path`, `telegram_url`, `uploaded_by`, `user_id`, `bot_token`, `is_downloaded`, `download_count`, `created_at`, `updated_at`, `folder_id`, `is_favorite`, `deleted_at`) VALUES
(3, 'BQACAgQAAyEGAATQVZmCAAMDaW4wdl8c5Rwoe3kMP1KRpdOBYmUAAi0dAALRr3BTeA_baDMcJUI4BA', 3, '676x676.png', '6362c4bc5ea2.png', NULL, 290189, 'image/png', 'image/png', NULL, NULL, NULL, 1, NULL, 0, 1, '2026-01-19 13:24:07', '2026-01-19 13:24:23', NULL, 0, NULL),
(5, 'BQACAgQAAyEGAATQVZmCAAMFaW4wvVBNXgK_oSiPVkV9np0LegEAAi8dAALRr3BT2_Z5f59fASo4BA', 5, 'Ekran görüntüsü 2025-04-15 230057.png', 'b8b08173bf5c.png', NULL, 621951, 'image/png', 'image/png', NULL, NULL, NULL, 1, NULL, 0, 0, '2026-01-19 13:25:18', '2026-01-19 13:25:18', NULL, 0, NULL),
(6, 'BQACAgQAAyEGAATQVZmCAAMGaW4wvlrY7zmZGwVizm71s_BNnOUAAjAdAALRr3BTpLcn4ELlykw4BA', 6, 'Ekran görüntüsü 2025-04-15 230304.png', '38c4fb17bcc9.png', NULL, 299348, 'image/png', 'image/png', NULL, NULL, NULL, 1, NULL, 0, 1, '2026-01-19 13:25:19', '2026-01-19 13:41:44', NULL, 0, NULL),
(7, 'BQACAgQAAyEGAATQVZmCAAMHaW4wwJ1153koSNN97iKSQSgZDbgAAjEdAALRr3BTF6iOyLQ-fPw4BA', 7, 'ic_launcher.png', 'b9bd0b694bfe.png', NULL, 352146, 'image/png', 'image/png', NULL, NULL, NULL, 1, NULL, 0, 1, '2026-01-19 13:25:20', '2026-01-19 13:25:35', NULL, 0, NULL),
(9, 'BQACAgQAAyEGAATQVZmCAAMJaW40fGAZjGaeknbvD51eCGBGuEEAAjMdAALRr3BTKBXWITVfESk4BA', 9, '8a7744c84e1f62ad.png', 'Ekran görüntüsü 2025-04-15 230304.png', NULL, 299348, 'image/png', 'image/png', NULL, 'https://t.me/c/3495270786/9', 0, 1, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 0, '2026-01-19 13:41:16', '2026-01-19 13:41:16', NULL, 0, NULL),
(11, 'BQACAgQAAyEGAATQVZmCAAMLaW40flPRKPrGCkCSvmrcKOwbbQwAAjUdAALRr3BTtK119BZKdbY4BA', 11, 'e5486abe22122fb0.png', 'ic_launcher.png', NULL, 352146, 'image/png', 'image/png', NULL, 'https://t.me/c/3495270786/11', 0, 1, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 1, '2026-01-19 13:41:19', '2026-01-19 13:41:39', NULL, 0, NULL),
(13, 'BQACAgQAAyEGAATQVZmCAAMNaW42YOSos1-DHs-i0VBuiyG9UJwAAqQcAALRr3hTwZ4dBm4TSUs4BA', 13, 'bdb3e4b7d6560b0a.png', '7653800-42.png', NULL, 1773, 'image/png', 'image/png', NULL, 'https://t.me/c/3495270786/13', 0, 1, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 0, '2026-01-19 13:49:21', '2026-01-19 13:49:21', NULL, 0, NULL),
(14, 'BQACAgQAAyEGAATQVZmCAAMOaW424uTaD8Q5YN3ZjEv9QHwwWaQAAqYcAALRr3hT1j1BLT00-Qk4BA', 14, '34e3962ea0d34021.jpg', 'Screenshot_20250302-203029.jpg', NULL, 94272, 'image/jpeg', 'image/jpeg', NULL, 'https://t.me/c/3495270786/14', 0, 1, '8505154109:AAExKru0XUvb7vYgH1zvGntJ_9Gz66WLscs', 0, 2, '2026-01-19 13:51:31', '2026-01-19 16:33:35', NULL, 0, NULL),
(15, 'BQACAgQAAyEGAATQVZmCAAMPaXEf1ciwYXGT7hicmDS6W7Lqkw4AAnMcAAKzfolT-2EAARfGJnPkOAQ', 15, 'Mert%20Samet%20Tas%CC%A7%204%20Gu%CC%88nlu%CC%88k%20SBD%201.Hafta%20.txt', '2d282d8f0f33_Mert%20Samet%20Tas%CC%A7%204%20Gu%CC%88nlu%CC%88k%20SBD%201.Hafta%20.txt', NULL, 1994, 'text/plain', 'text/plain', NULL, NULL, NULL, 2, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 1, '2026-01-21 18:49:59', '2026-01-21 18:50:46', NULL, 0, NULL),
(16, 'BQACAgQAAyEGAATQVZmCAAMQaXEgFGjJQ0zVvlnainCEG96JL9EAAnYcAAKzfolTg6XE3gZrzAc4BA', 16, 'Dekont.pdf', 'ceb95fb31e30_Dekont.pdf', NULL, 127552, 'application/pdf', 'application/pdf', NULL, NULL, NULL, 2, '8505154109:AAExKru0XUvb7vYgH1zvGntJ_9Gz66WLscs', 0, 0, '2026-01-21 18:51:02', '2026-01-21 18:51:02', NULL, 0, NULL),
(17, 'BQACAgQAAyEGAATQVZmCAAMRaXEgXIf7QSN1cpe4x2cdprMs4pAAAngcAAKzfolT6Qp728Jaap84BA', 17, 'Dekont.pdf', 'a1288ce653b7_Dekont.pdf', NULL, 127552, 'application/pdf', 'application/pdf', NULL, NULL, NULL, 2, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 0, '2026-01-21 18:52:13', '2026-01-21 18:52:13', 1, 0, NULL),
(18, 'BQACAgQAAyEGAATQVZmCAAMSafO4efBTNAlhvbRwSEQa9742ihcAAucgAAKAHaBTzhmIlr_pMkI7BA', 18, '3A07B599-0A52-48EC-8DDC-35E9AB34FE7D.jpeg', '3A07B599-0A52-48EC-8DDC-35E9AB34FE7D.jpeg', '8ee03e733e6fed8d66ff5e794dba32b8e97fdbd6ab31ece2', 807330, 'image/jpeg', 'image/jpeg', NULL, 'https://api.telegram.org/file/bot8505154109:AAExKru0XUvb7vYgH1zvGntJ_9Gz66WLscs/documents/file_4.jpeg', NULL, 2, '8505154109:AAExKru0XUvb7vYgH1zvGntJ_9Gz66WLscs', 0, 2, '2026-04-30 20:15:54', '2026-04-30 20:44:25', NULL, 1, NULL),
(19, 'BQACAgQAAyEGAATQVZmCAAMTafPOSG6TYPh1hnxn2m2_Mg7Rw_kAAu4gAAKAHaBT5fx0phos3w47BA', 19, '6646A339-0DC3-466F-BA90-A952BAC5F399.jpeg', '6646A339-0DC3-466F-BA90-A952BAC5F399.jpeg', NULL, 807330, 'image/jpeg', 'image/jpeg', NULL, 'https://api.telegram.org/file/bot7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto/documents/file_35.jpeg', NULL, 2, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 0, '2026-04-30 21:48:56', '2026-04-30 21:49:15', NULL, 0, '2026-04-30 18:49:15'),
(20, 'BQACAgQAAyEGAATQVZmCAAMWafPP_wLou851QEP9EBwtWAsFziMAAvEgAAKAHaBTN0vPcnMycOE7BA', 22, '42E41589-886F-44B8-8D62-927BE359AD5A.jpeg', '42E41589-886F-44B8-8D62-927BE359AD5A.jpeg', NULL, 802031, 'image/jpeg', 'image/jpeg', NULL, 'https://api.telegram.org/file/bot7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto/documents/file_36.jpeg', NULL, 2, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 0, '2026-04-30 21:56:16', '2026-04-30 22:05:26', NULL, 0, '2026-04-30 19:05:26'),
(21, 'BAACAgQAAyEGAATQVZmCAAMYafPS-Rsn0bt2fk4qdtz8_jOn_lMAAvMgAAKAHaBTXz-LjjyzbxE7BA', 24, 'A84E3D35-C5BC-46AA-ADEA-EE1F6C006EFA.mp4', 'A84E3D35-.mp4', NULL, 8736763, 'video/mp4', 'video/mp4', NULL, 'https://api.telegram.org/file/bot7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto/videos/file_37.mp4', NULL, 2, '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto', 0, 26, '2026-04-30 22:09:00', '2026-04-30 22:51:17', NULL, 1, NULL);

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `file_tags`
--

CREATE TABLE `file_tags` (
  `file_id` int NOT NULL,
  `tag_id` int NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `folders`
--

CREATE TABLE `folders` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `parent_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

--
-- Tablo döküm verisi `folders`
--

INSERT INTO `folders` (`id`, `user_id`, `name`, `parent_id`, `created_at`, `deleted_at`) VALUES
(1, 2, 'folder', NULL, '2026-01-21 18:35:27', '2026-04-30 18:38:33');

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `system_config`
--

CREATE TABLE `system_config` (
  `config_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_value` text COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Tablo döküm verisi `system_config`
--

INSERT INTO `system_config` (`config_key`, `config_value`, `updated_at`) VALUES
('telethon_session', '1BJWap1sBuyx5HJpJ_3yZI-OFcB3JXk_Gm1he-8_2A428TzNdfnaZxk_v0-K__GD2Dw_dlHNHTQqSe_VALrwbGL2v_PZmplGsmYTlkBl9ymU1r7qlh6x0-EOPMX8VBJjjZ_1aUc84KUVQoYy91U4vcDxf-QUU3_nBcLLRvTgIXFT1yIW5TtCu5e5IfSDOGWhit1BZpFQv0Pzc-kBcapm6qMe8YR51oNwRcKGftMJqETEGpJt6KC-vMcQqYL9je1mWKHAAz_U2cdYoEDw7cNr1JXAIg3HqDtV218D4T87fW_1LU2mP0Zq_BK6RtujcGlfcrkdMt3_a-Z4hKjJHfbGZlhyY5RErtFY=', '2026-01-19 12:43:01');

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `tags`
--

CREATE TABLE `tags` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `color` varchar(7) DEFAULT '#3e577a',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- --------------------------------------------------------

--
-- Tablo için tablo yapısı `users`
--

CREATE TABLE `users` (
  `id` int NOT NULL,
  `telegram_id` bigint DEFAULT NULL,
  `username` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `first_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `role` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'user',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `plan_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'free',
  `plan_storage_limit` bigint DEFAULT NULL,
  `plan_started_at` timestamp NULL DEFAULT NULL,
  `plan_expires_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Tablo döküm verisi `users`
--

INSERT INTO `users` (`id`, `telegram_id`, `username`, `email`, `password_hash`, `first_name`, `last_name`, `is_active`, `role`, `created_at`, `updated_at`, `plan_type`, `plan_storage_limit`, `plan_started_at`, `plan_expires_at`) VALUES
(1, NULL, 'adminn', 'adminn@admin.com', '$2y$10$rWYCbJcwjFCKa8/lMQXqDuxaKlBPesothjdV2wlzVZj.NOXaonnqu', 'Sistem', 'Yöneticisi', 1, 'admin', '2026-01-19 12:46:05', '2026-01-19 13:40:47', 'free', NULL, NULL, NULL),
(2, NULL, 'köfte', 'admin2@admin.com', '$2y$10$mI5v1LeX.r7CaL6JAAfb1OVNSFY8wG6H6MJlwo7qzTtMjYUNCxWVa', 'köfte', 'kofte', 1, 'user', '2026-01-21 18:10:15', '2026-04-30 21:31:07', 'pro', 549755813888, '2026-04-30 21:31:07', NULL),
(3, NULL, 'testuser', 'test@test.com', '$2y$12$mvf54Qt0zC2if01zSMa3KuKKqeYz50vzXR9uQwFUQzHB11PJcmxTq', 'Test', 'User', 1, 'user', '2026-01-23 21:29:51', '2026-01-23 21:29:51', 'free', NULL, NULL, NULL);

--
-- Dökümü yapılmış tablolar için indeksler
--

--
-- Tablo için indeksler `api_keys`
--
ALTER TABLE `api_keys`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `api_key` (`api_key`);

--
-- Tablo için indeksler `download_logs`
--
ALTER TABLE `download_logs`
  ADD PRIMARY KEY (`id`);

--
-- Tablo için indeksler `files`
--
ALTER TABLE `files`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `telegram_file_id` (`telegram_file_id`),
  ADD UNIQUE KEY `idx_files_share_token` (`share_token`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `files_ibfk_folder_id` (`folder_id`);

--
-- Tablo için indeksler `file_tags`
--
ALTER TABLE `file_tags`
  ADD PRIMARY KEY (`file_id`,`tag_id`),
  ADD KEY `tag_id` (`tag_id`);

--
-- Tablo için indeksler `folders`
--
ALTER TABLE `folders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `parent_id` (`parent_id`);

--
-- Tablo için indeksler `system_config`
--
ALTER TABLE `system_config`
  ADD PRIMARY KEY (`config_key`);

--
-- Tablo için indeksler `tags`
--
ALTER TABLE `tags`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Tablo için indeksler `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `telegram_id` (`telegram_id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Dökümü yapılmış tablolar için AUTO_INCREMENT değeri
--

--
-- Tablo için AUTO_INCREMENT değeri `api_keys`
--
ALTER TABLE `api_keys`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Tablo için AUTO_INCREMENT değeri `download_logs`
--
ALTER TABLE `download_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=40;

--
-- Tablo için AUTO_INCREMENT değeri `files`
--
ALTER TABLE `files`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=22;

--
-- Tablo için AUTO_INCREMENT değeri `folders`
--
ALTER TABLE `folders`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- Tablo için AUTO_INCREMENT değeri `tags`
--
ALTER TABLE `tags`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- Tablo için AUTO_INCREMENT değeri `users`
--
ALTER TABLE `users`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- Dökümü yapılmış tablolar için kısıtlamalar
--

--
-- Tablo kısıtlamaları `files`
--
ALTER TABLE `files`
  ADD CONSTRAINT `files_ibfk_folder_id` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `files_ibfk_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_files_folder` FOREIGN KEY (`folder_id`) REFERENCES `folders` (`id`) ON DELETE SET NULL;

--
-- Tablo kısıtlamaları `file_tags`
--
ALTER TABLE `file_tags`
  ADD CONSTRAINT `file_tags_ibfk_1` FOREIGN KEY (`file_id`) REFERENCES `files` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `file_tags_ibfk_2` FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE;

--
-- Tablo kısıtlamaları `folders`
--
ALTER TABLE `folders`
  ADD CONSTRAINT `folders_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `folders_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `folders` (`id`) ON DELETE CASCADE;

--
-- Tablo kısıtlamaları `tags`
--
ALTER TABLE `tags`
  ADD CONSTRAINT `tags_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
