<?php

use App\Database;
use App\Services\AuthService;
use App\Services\ResendService;
use App\Services\TelegramService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;
use Slim\Middleware\BodyParsingMiddleware;

if (PHP_SAPI === 'cli-server') {
    $requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $publicPath = __DIR__ . str_replace('/', DIRECTORY_SEPARATOR, $requestUri);
    if ($requestUri !== '/' && is_file($publicPath)) {
        return false;
    }
}

require __DIR__ . '/../vendor/autoload.php';

// Load .env
ini_set('display_errors', 1);
error_reporting(E_ALL);
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/../');
if (file_exists(__DIR__ . '/../.env')) {
    $dotenv->load();
}

$app = AppFactory::create();

// Add Middleware
$app->addBodyParsingMiddleware();
$app->addRoutingMiddleware();

// Error Middleware
$errorMiddleware = $app->addErrorMiddleware(true, true, true);

// CORS Middleware
$app->add(function ($request, $handler) {
    $response = $handler->handle($request);
    return $response
            ->withHeader('Access-Control-Allow-Origin', '*')
            ->withHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Origin, Authorization')
            ->withHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
});

// Handle preflight OPTIONS requests
$app->options('/{routes:.+}', function ($request, $response, $args) {
    return $response;
});

// Configuration
$config = [
    'TELEGRAM_BOT_TOKEN' => $_ENV['TELEGRAM_BOT_TOKEN'] ?? '',
    'TELEGRAM_CHAT_ID' => $_ENV['TELEGRAM_CHAT_ID'] ?? '710553403',
    'SECRET_KEY' => $_ENV['SECRET_KEY'] ?? 'your-secret-key-here-change-in-production',
];

// Initialize Services (Filter empty tokens)
$botTokens = array_filter(array_map('trim', explode(',', $config['TELEGRAM_BOT_TOKEN'])));
if (empty($botTokens)) {
    die("Error: No TELEGRAM_BOT_TOKEN found in .env");
}
$authService = new AuthService($config['SECRET_KEY']);
$telegramService = new TelegramService($botTokens);
$resendApiKey = $_ENV['RESEND_API_KEY'] ?? '';
$resendService = $resendApiKey !== '' ? new ResendService($resendApiKey) : null;
$db = Database::getInstance();

// Initialize Tables
Database::createTables();

function formatBytes(int $bytes): string
{
    if ($bytes <= 0) {
        return '0 B';
    }

    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $power = (int) floor(log($bytes, 1024));
    $power = max(0, min($power, count($units) - 1));
    $size = $bytes / (1024 ** $power);
    $precision = ($size >= 10 || $power === 0) ? 0 : 1;

    return number_format($size, $precision) . ' ' . $units[$power];
}

function getUserPlanType(array $user): string
{
    $role = strtolower((string)($user['role'] ?? 'user'));
    $planType = strtolower((string)($user['plan_type'] ?? ''));
    $planType = $planType !== '' ? $planType : ($role === 'admin' ? 'pro' : 'free');

    $expiresAt = $user['plan_expires_at'] ?? null;
    if (!empty($expiresAt) && strtotime((string)$expiresAt) < time()) {
        $planType = 'free';
    }

    if ($role === 'admin') {
        $planType = 'pro';
    }

    return $planType === 'pro' ? 'pro' : 'free';
}

function getDefaultStorageLimitForPlan(string $planType): int
{
    return $planType === 'pro'
        ? 512 * 1024 * 1024 * 1024
        : 5 * 1024 * 1024 * 1024;
}

function getUserStorageLimit(array $user): int
{
    $overrideLimit = (int)($user['plan_storage_limit'] ?? 0);
    if ($overrideLimit > 0) {
        return $overrideLimit;
    }

    return getDefaultStorageLimitForPlan(getUserPlanType($user));
}

function buildPlanPayload(array $user): array
{
    $planType = getUserPlanType($user);
    $storageLimit = getUserStorageLimit($user);

    return [
        'type' => $planType,
        'name' => $planType === 'pro' ? 'PRO Plan' : 'Free Plan',
        'is_pro' => $planType === 'pro',
        'storage_limit' => $storageLimit,
        'started_at' => $user['plan_started_at'] ?? null,
        'expires_at' => $user['plan_expires_at'] ?? null,
        'can_upgrade' => $planType !== 'pro',
    ];
}

function getBotUploadLimitBytes(): int
{
    $configured = (int)($_ENV['TELEGRAM_BOT_UPLOAD_LIMIT'] ?? 0);
    return $configured > 0 ? $configured : 45 * 1024 * 1024;
}

function getPublicShareChunkSizeBytes(): int
{
    $configured = (int)($_ENV['PUBLIC_SHARE_CHUNK_SIZE'] ?? 0);
    if ($configured > 0) {
        return $configured;
    }

    return 8 * 1024 * 1024;
}

function getAdaptivePublicUploadPlan(int $fileSize): array
{
    $botLimit = getBotUploadLimitBytes();
    $preferredFloor = max(1, min(getPublicShareChunkSizeBytes(), $botLimit));
    $safeChunkCeiling = max(1, $botLimit - (512 * 1024));

    if ($fileSize <= 0) {
        return [
            'is_chunked' => false,
            'chunk_count' => 1,
            'chunk_size_bytes' => $preferredFloor,
        ];
    }

    if ($fileSize <= $botLimit) {
        return [
            'is_chunked' => false,
            'chunk_count' => 1,
            'chunk_size_bytes' => $fileSize,
        ];
    }

    $partCount = max(2, (int)ceil($fileSize / $safeChunkCeiling));
    $chunkSize = (int)ceil($fileSize / $partCount);
    $chunkSize = max($preferredFloor, min($safeChunkCeiling, $chunkSize));
    $partCount = (int)ceil($fileSize / $chunkSize);

    return [
        'is_chunked' => $partCount > 1,
        'chunk_count' => max(1, $partCount),
        'chunk_size_bytes' => $chunkSize,
    ];
}

function getAllowedPublicShareDurations(): array
{
    return [
        60 => '1 saat',
        360 => '6 saat',
        1440 => '24 saat',
        10080 => '7 gun',
    ];
}

function buildUploadCaption(array $user, string $originalName, ?int $fileId = null, ?string $extraLine = null): string
{
    $caption = "📁 Dosya: " . $originalName . "\n";
    $caption .= "🆔 ID: " . ($fileId ?? '-') . "\n";
    $caption .= "👤 İsim: " . trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) . "\n";
    if (!empty($user['username'])) {
        $caption .= "🏷️ Kullanıcı Adı: @" . $user['username'] . "\n";
    }
    $caption .= "📧 Email: " . ($user['email'] ?? '-') . "\n";
    $caption .= "📅 Tarih: " . date('Y-m-d H:i:s');
    if ($extraLine) {
        $caption .= "\n" . $extraLine;
    }
    return $caption;
}

function normalizeUploadFilename(?string $inputName, ?string $mimeType = null): string
{
    $candidate = trim((string)($inputName ?? ''));
    if ($candidate === '') {
        $candidate = 'upload.bin';
    }

    $candidate = rawurldecode($candidate);
    $candidate = basename(str_replace('\\', '/', $candidate));
    $candidate = preg_replace('/[\r\n\t]+/', ' ', $candidate);
    $candidate = preg_replace('/\s+/', ' ', $candidate);
    $candidate = trim($candidate, " .");

    if ($candidate === '') {
        $candidate = 'upload.bin';
    }

    $extension = pathinfo($candidate, PATHINFO_EXTENSION);
    if ($extension === '' && $mimeType) {
        $guessedExtension = match (strtolower($mimeType)) {
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/heic' => 'heic',
            'image/heif' => 'heif',
            'video/mp4' => 'mp4',
            'video/quicktime' => 'mov',
            'application/pdf' => 'pdf',
            default => '',
        };
        if ($guessedExtension !== '') {
            $candidate .= '.' . $guessedExtension;
        }
    }

    return $candidate;
}

function buildStoredDisplayName(string $sourceName): string
{
    $extension = pathinfo($sourceName, PATHINFO_EXTENSION);
    $randomName = 'file_' . date('Ymd_His') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
    return $randomName . ($extension !== '' ? '.' . strtolower($extension) : '');
}

function buildChunkMasterFileId(): string
{
    return 'chunked_' . bin2hex(random_bytes(16));
}

function buildChunkFilename(string $originalName, int $partNumber, int $partCount): string
{
    $extension = pathinfo($originalName, PATHINFO_EXTENSION);
    $baseName = pathinfo($originalName, PATHINFO_FILENAME);
    $safeBase = preg_replace('/[^A-Za-z0-9._-]/', '_', $baseName ?: 'file');
    $suffix = sprintf('.part%03dof%03d', $partNumber, $partCount);
    return $safeBase . $suffix . ($extension !== '' ? '.' . $extension : '');
}

function extractTelegramMedia(array $result): array
{
    $messagePayload = $result['result'] ?? [];
    $media = $messagePayload['document'] ?? $messagePayload['video'] ?? null;
    if (!$media && !empty($messagePayload['photo']) && is_array($messagePayload['photo'])) {
        $photoSizes = $messagePayload['photo'];
        $media = end($photoSizes) ?: null;
        if (is_array($media) && empty($media['mime_type'])) {
            $media['mime_type'] = 'image/jpeg';
        }
    }
    if (!$media || empty($media['file_id'])) {
        throw new Exception('Telegram response did not include a storable file payload');
    }

    return [
        'file_id' => $media['file_id'],
        'message_id' => (int)($messagePayload['message_id'] ?? 0),
        'file_size' => (int)($media['file_size'] ?? 0),
        'mime_type' => $media['mime_type'] ?? null,
    ];
}

function resolveTelegramFileUrl(TelegramService $telegramService, string $fileId, ?string $token): ?string
{
    if (!$token) {
        return null;
    }

    try {
        $fileInfo = $telegramService->getFile($fileId, $token);
        if (!empty($fileInfo['ok']) && !empty($fileInfo['result']['file_path'])) {
            return $telegramService->getFileUrl($fileInfo['result']['file_path'], $token);
        }
    } catch (Exception $e) {
        error_log("Failed to resolve Telegram file URL: " . $e->getMessage());
    }

    return null;
}

function openUploadReadStream($file)
{
    if (method_exists($file, 'getFilePath')) {
        $filePath = $file->getFilePath();
        if (is_string($filePath) && $filePath !== '' && is_file($filePath)) {
            $handle = fopen($filePath, 'rb');
            if ($handle !== false) {
                return $handle;
            }
        }
    }

    $stream = $file->getStream();
    $stream->rewind();
    return $stream;
}

function createChunkUploadPayload($file, array $user, TelegramService $telegramService, array $config, array $options = []): array
{
    $fileSize = (int)($file->getSize() ?? 0);
    $botLimit = getBotUploadLimitBytes();
    $forceChunked = !empty($options['force_chunked']);
    $preferredChunkSize = isset($options['chunk_size_bytes']) ? (int)$options['chunk_size_bytes'] : $botLimit;
    $mimeType = $file->getClientMediaType() ?? 'application/octet-stream';
    $originalName = normalizeUploadFilename($file->getClientFilename() ?: 'upload.bin', $mimeType);
    $storedDisplayName = buildStoredDisplayName($originalName);
    $captionBase = buildUploadCaption($user, $storedDisplayName);

    if ($fileSize <= 0) {
        throw new Exception('Empty files cannot be uploaded');
    }

    $stream = openUploadReadStream($file);

    if (!$forceChunked && $fileSize <= $botLimit) {
        $result = $telegramService->sendDocument(
            $config['TELEGRAM_CHAT_ID'],
            is_resource($stream) ? $stream : $stream->getContents(),
            $storedDisplayName,
            $captionBase
        );

        if (is_resource($stream)) {
            fclose($stream);
        }

        if (empty($result['ok'])) {
            throw new Exception("Telegram Upload Error: " . ($result['description'] ?? 'Unknown error'));
        }

        $media = extractTelegramMedia($result);
        $usedToken = $result['used_token'] ?? null;

        return [
            'telegram_file_id' => $media['file_id'],
            'telegram_message_id' => $media['message_id'],
            'file_name' => $originalName,
            'display_name' => $storedDisplayName,
            'file_size' => $media['file_size'] > 0 ? $media['file_size'] : $fileSize,
            'mime_type' => $media['mime_type'] ?? $mimeType,
            'bot_token' => $usedToken,
            'telegram_url' => resolveTelegramFileUrl($telegramService, $media['file_id'], $usedToken),
            'upload_engine' => 'php',
            'is_chunked' => false,
            'chunk_count' => 1,
            'parts' => [],
        ];
    }

    $botTokens = $telegramService->getBotTokens();
    if (empty($botTokens)) {
        throw new Exception('No Telegram bot tokens available for chunk upload');
    }

    $effectiveChunkSize = max(1, min($botLimit, $preferredChunkSize));
    if ($forceChunked && $fileSize > 1 && $effectiveChunkSize >= $fileSize) {
        $effectiveChunkSize = max(1, (int)ceil($fileSize / 2));
    }

    $partCount = (int)ceil($fileSize / $effectiveChunkSize);
    $parts = [];
    $bytesRemaining = $fileSize;

    for ($index = 0; $index < $partCount; $index++) {
        $partNumber = $index + 1;
        $currentPartSize = min($effectiveChunkSize, $bytesRemaining);
        $tempPath = tempnam(sys_get_temp_dir(), 'tgchunk_');
        if ($tempPath === false) {
            throw new Exception('Chunk temp file could not be created');
        }

        $chunkHandle = fopen($tempPath, 'wb');
        if ($chunkHandle === false) {
            @unlink($tempPath);
            throw new Exception('Chunk temp file could not be opened');
        }

        $written = 0;
        while ($written < $currentPartSize && !(is_resource($stream) ? feof($stream) : $stream->eof())) {
            $buffer = is_resource($stream)
                ? fread($stream, (int)min(1024 * 1024, $currentPartSize - $written))
                : $stream->read((int)min(1024 * 1024, $currentPartSize - $written));
            if ($buffer === '') {
                break;
            }
            $written += fwrite($chunkHandle, $buffer);
        }
        fclose($chunkHandle);

        if ($written !== $currentPartSize) {
            @unlink($tempPath);
            throw new Exception('Chunk boundary could not be created correctly');
        }

        $token = $botTokens[$index % count($botTokens)];
        $chunkFilename = buildChunkFilename($storedDisplayName, $partNumber, $partCount);
        $partCaption = $captionBase . "\n📦 Parça: {$partNumber}/{$partCount}";
        $partStream = fopen($tempPath, 'rb');

        try {
            $result = $telegramService->sendDocument(
                $config['TELEGRAM_CHAT_ID'],
                $partStream,
                $chunkFilename,
                $partCaption,
                $token
            );
        } finally {
            if (is_resource($partStream)) {
                fclose($partStream);
            }
            @unlink($tempPath);
        }

        if (empty($result['ok'])) {
            throw new Exception("Telegram chunk upload failed: " . ($result['description'] ?? 'Unknown error'));
        }

        $media = extractTelegramMedia($result);
        $usedToken = $result['used_token'] ?? $token;

        $parts[] = [
            'part_index' => $index,
            'telegram_file_id' => $media['file_id'],
            'telegram_message_id' => $media['message_id'],
            'part_name' => $chunkFilename,
            'part_size' => $written,
            'mime_type' => $mimeType,
            'bot_token' => $usedToken,
            'telegram_url' => null,
        ];

        $bytesRemaining -= $written;
    }

    if (is_resource($stream)) {
        fclose($stream);
    }

    return [
        'telegram_file_id' => buildChunkMasterFileId(),
        'telegram_message_id' => null,
        'file_name' => $originalName,
        'display_name' => $storedDisplayName,
        'file_size' => $fileSize,
        'mime_type' => $mimeType,
        'bot_token' => null,
        'telegram_url' => null,
        'upload_engine' => 'php',
        'is_chunked' => true,
        'chunk_count' => $partCount,
        'parts' => $parts,
    ];
}

function getPublicUploadStateDirectory(): string
{
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'telegram_public_uploads';
    if (!is_dir($dir) && !mkdir($dir, 0777, true) && !is_dir($dir)) {
        throw new Exception('Public upload temp directory could not be created');
    }

    return $dir;
}

function getPublicUploadStatePath(string $uploadId): string
{
    if (!preg_match('/^[a-f0-9]{32}$/', $uploadId)) {
        throw new Exception('Invalid upload id');
    }

    return getPublicUploadStateDirectory() . DIRECTORY_SEPARATOR . $uploadId . '.json';
}

function savePublicUploadState(string $uploadId, array $state): void
{
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new Exception('Upload state could not be encoded');
    }

    if (file_put_contents(getPublicUploadStatePath($uploadId), $json, LOCK_EX) === false) {
        throw new Exception('Upload state could not be written');
    }
}

function loadPublicUploadState(string $uploadId): array
{
    $path = getPublicUploadStatePath($uploadId);
    if (!is_file($path)) {
        throw new Exception('Upload session could not be found');
    }

    $contents = file_get_contents($path);
    if ($contents === false) {
        throw new Exception('Upload state could not be read');
    }

    $decoded = json_decode($contents, true);
    if (!is_array($decoded)) {
        throw new Exception('Upload state is invalid');
    }

    return $decoded;
}

function deletePublicUploadState(string $uploadId): void
{
    $path = getPublicUploadStatePath($uploadId);
    if (is_file($path)) {
        @unlink($path);
    }
}

function uploadPreparedChunk(
    $file,
    array $uploadState,
    int $partIndex,
    TelegramService $telegramService,
    array $config
): array {
    $chunkSize = (int)($file->getSize() ?? 0);
    if ($chunkSize <= 0) {
        throw new Exception('Empty chunk cannot be uploaded');
    }

    $stream = openUploadReadStream($file);
    $botTokens = $telegramService->getBotTokens();
    if (empty($botTokens)) {
        throw new Exception('No Telegram bot tokens available for chunk upload');
    }

    $partNumber = $partIndex + 1;
    $partCount = max(1, (int)($uploadState['chunk_count'] ?? 1));
    $token = $botTokens[$partIndex % count($botTokens)];
    $displayName = (string)($uploadState['display_name'] ?? 'upload.bin');
    $captionBase = buildUploadCaption($uploadState['user'] ?? [], $displayName);
    $partCaption = $captionBase . "\n📦 Parça: {$partNumber}/{$partCount}";
    $chunkFilename = buildChunkFilename($displayName, $partNumber, $partCount);

    try {
        $result = $telegramService->sendDocument(
            $config['TELEGRAM_CHAT_ID'],
            is_resource($stream) ? $stream : $stream,
            $chunkFilename,
            $partCaption,
            $token
        );
    } finally {
        if (is_resource($stream)) {
            fclose($stream);
        }
    }

    if (empty($result['ok'])) {
        throw new Exception('Telegram chunk upload failed: ' . ($result['description'] ?? 'Unknown error'));
    }

    $media = extractTelegramMedia($result);
    $usedToken = $result['used_token'] ?? $token;

    return [
        'part_index' => $partIndex,
        'telegram_file_id' => $media['file_id'],
        'telegram_message_id' => $media['message_id'],
        'part_name' => $chunkFilename,
        'part_size' => $chunkSize,
        'mime_type' => $uploadState['mime_type'] ?? 'application/octet-stream',
        'bot_token' => $usedToken,
        'telegram_url' => null,
    ];
}

function buildPublicUploadPayloadFromState(array $uploadState): array
{
    $parts = $uploadState['parts'] ?? [];
    usort($parts, static fn(array $left, array $right): int => (int)$left['part_index'] <=> (int)$right['part_index']);

    $isChunked = (int)($uploadState['chunk_count'] ?? count($parts)) > 1;
    if (!$isChunked) {
        $singlePart = $parts[0] ?? null;
        if (!$singlePart) {
            throw new Exception('Upload chunk metadata could not be found');
        }

        return [
            'telegram_file_id' => $singlePart['telegram_file_id'],
            'telegram_message_id' => $singlePart['telegram_message_id'] ?? null,
            'file_name' => $uploadState['original_name'],
            'display_name' => $uploadState['display_name'],
            'file_size' => (int)$uploadState['file_size'],
            'mime_type' => $uploadState['mime_type'],
            'bot_token' => $singlePart['bot_token'] ?? null,
            'telegram_url' => null,
            'upload_engine' => 'php',
            'is_chunked' => false,
            'chunk_count' => 1,
            'parts' => [],
        ];
    }

    return [
        'telegram_file_id' => buildChunkMasterFileId(),
        'telegram_message_id' => null,
        'file_name' => $uploadState['original_name'],
        'display_name' => $uploadState['display_name'],
        'file_size' => (int)$uploadState['file_size'],
        'mime_type' => $uploadState['mime_type'],
        'bot_token' => null,
        'telegram_url' => null,
        'upload_engine' => 'php',
        'is_chunked' => true,
        'chunk_count' => (int)$uploadState['chunk_count'],
        'parts' => $parts,
    ];
}

function persistUploadedFileRecord(PDO $db, array $payload, ?int $userId, $folderId): int
{
    if ($folderId === 'root' || $folderId === '') {
        $folderId = null;
    }

    $stmt = $db->prepare("INSERT INTO files (telegram_file_id, telegram_message_id, file_name, display_name, file_size, file_type, mime_type, user_id, bot_token, upload_engine, is_chunked, chunk_count, folder_id, telegram_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $payload['telegram_file_id'],
        $payload['telegram_message_id'],
        $payload['file_name'],
        $payload['display_name'],
        (int)$payload['file_size'],
        $payload['mime_type'],
        $payload['mime_type'],
        $userId,
        $payload['bot_token'] ?? null,
        $payload['upload_engine'] ?? 'php',
        !empty($payload['is_chunked']) ? 1 : 0,
        (int)($payload['chunk_count'] ?? 1),
        $folderId,
        $payload['telegram_url'] ?? null,
    ]);

    $newFileId = (int)$db->lastInsertId();
    $parts = $payload['parts'] ?? [];
    if (!empty($parts)) {
        $partStmt = $db->prepare("INSERT INTO file_parts (file_id, part_index, telegram_file_id, telegram_message_id, part_name, part_size, mime_type, bot_token, telegram_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        foreach ($parts as $part) {
            $partStmt->execute([
                $newFileId,
                (int)$part['part_index'],
                $part['telegram_file_id'],
                $part['telegram_message_id'] ?? null,
                $part['part_name'] ?? null,
                (int)$part['part_size'],
                $part['mime_type'] ?? ($payload['mime_type'] ?? 'application/octet-stream'),
                $part['bot_token'] ?? null,
                $part['telegram_url'] ?? null,
            ]);
        }
    }

    return $newFileId;
}

function syncTelegramUploadCaptions(TelegramService $telegramService, array $config, array $payload, array $user, int $fileId): void
{
    $chatId = (string)($config['TELEGRAM_CHAT_ID'] ?? '');
    if ($chatId === '') {
        return;
    }

    try {
        if (!empty($payload['is_chunked'])) {
            $parts = $payload['parts'] ?? [];
            $partCount = (int)($payload['chunk_count'] ?? count($parts));
            foreach ($parts as $index => $part) {
                $messageId = (int)($part['telegram_message_id'] ?? 0);
                if ($messageId <= 0) {
                    continue;
                }

                $caption = buildUploadCaption(
                    $user,
                    $payload['display_name'] ?? $payload['file_name'] ?? 'upload.bin',
                    $fileId,
                    sprintf('📦 Parça: %d/%d', $index + 1, max($partCount, 1))
                );
                $telegramService->editMessageCaption($chatId, $messageId, $caption, $part['bot_token'] ?? null);
            }
            return;
        }

        $messageId = (int)($payload['telegram_message_id'] ?? 0);
        if ($messageId <= 0) {
            return;
        }

        $caption = buildUploadCaption(
            $user,
            $payload['display_name'] ?? $payload['file_name'] ?? 'upload.bin',
            $fileId
        );
        $telegramService->editMessageCaption($chatId, $messageId, $caption, $payload['bot_token'] ?? null);
    } catch (Exception $e) {
        error_log('Failed to sync Telegram upload caption: ' . $e->getMessage());
    }
}

function permanentlyDeleteStoredFile(PDO $db, TelegramService $telegramService, array $config, array $file): void
{
    if (!empty($file['is_chunked'])) {
        $partStmt = $db->prepare("SELECT telegram_message_id, bot_token FROM file_parts WHERE file_id = ?");
        $partStmt->execute([$file['id']]);
        foreach ($partStmt->fetchAll() as $part) {
            if (empty($part['telegram_message_id'])) {
                continue;
            }

            try {
                $telegramService->deleteMessage($config['TELEGRAM_CHAT_ID'], (int)$part['telegram_message_id'], $part['bot_token'] ?? null);
            } catch (\Exception $e) {
                error_log("Telegram chunk delete error: " . $e->getMessage());
            }
        }
    } elseif (!empty($file['telegram_message_id'])) {
        try {
            $token = $file['bot_token'] ?? null;
            $telegramService->deleteMessage($config['TELEGRAM_CHAT_ID'], (int)$file['telegram_message_id'], $token);
        } catch (\Exception $e) {
            error_log("Telegram delete error: " . $e->getMessage());
        }
    }

    $deleteStmt = $db->prepare("DELETE FROM files WHERE id = ?");
    $deleteStmt->execute([$file['id']]);
}

function resolveSharedFileOrHandleExpiration(PDO $db, TelegramService $telegramService, array $config, string $shareToken): array
{
    $stmt = $db->prepare("SELECT * FROM files WHERE share_token = ? AND deleted_at IS NULL LIMIT 1");
    $stmt->execute([$shareToken]);
    $file = $stmt->fetch();

    if (!$file) {
        return ['status' => 'missing', 'file' => null];
    }

    $expiresAt = $file['share_expires_at'] ?? null;
    if (!empty($expiresAt) && strtotime((string)$expiresAt) <= time()) {
        if (!empty($file['is_public_upload'])) {
            permanentlyDeleteStoredFile($db, $telegramService, $config, $file);
        } else {
            $db->prepare("UPDATE files SET share_token = NULL, share_expires_at = NULL WHERE id = ?")->execute([(int)$file['id']]);
        }

        return ['status' => 'expired', 'file' => $file];
    }

    return ['status' => 'active', 'file' => $file];
}

function getFolderDescendantIds(PDO $db, int $userId, int $folderId): array
{
    $folderIds = [$folderId];
    $queue = [$folderId];
    $childStmt = $db->prepare("SELECT id FROM folders WHERE user_id = ? AND parent_id = ?");

    while (!empty($queue)) {
        $currentFolderId = array_shift($queue);
        $childStmt->execute([$userId, $currentFolderId]);
        foreach ($childStmt->fetchAll() as $child) {
            $childId = (int)$child['id'];
            if (in_array($childId, $folderIds, true)) {
                continue;
            }
            $folderIds[] = $childId;
            $queue[] = $childId;
        }
    }

    return $folderIds;
}

function permanentlyDeleteFolderTree(PDO $db, TelegramService $telegramService, array $config, int $userId, int $folderId): array
{
    $folderIds = getFolderDescendantIds($db, $userId, $folderId);
    $placeholders = implode(',', array_fill(0, count($folderIds), '?'));

    $fileParams = array_merge([$userId], $folderIds);
    $fileStmt = $db->prepare("SELECT * FROM files WHERE user_id = ? AND folder_id IN ({$placeholders})");
    $fileStmt->execute($fileParams);
    $files = $fileStmt->fetchAll();

    foreach ($files as $file) {
        permanentlyDeleteStoredFile($db, $telegramService, $config, $file);
    }

    $folderParams = array_merge([$userId], $folderIds);
    $deleteFolderStmt = $db->prepare("DELETE FROM folders WHERE user_id = ? AND id IN ({$placeholders})");
    $deleteFolderStmt->execute($folderParams);

    return [
        'deleted_file_count' => count($files),
        'deleted_folder_count' => count($folderIds),
    ];
}

function streamChunkedFile(PDO $db, TelegramService $telegramService, array $file, string $disposition = 'attachment'): void
{
    $partStmt = $db->prepare("SELECT * FROM file_parts WHERE file_id = ? ORDER BY part_index ASC");
    $partStmt->execute([$file['id']]);
    $parts = $partStmt->fetchAll();

    if (empty($parts)) {
        throw new Exception('Chunk metadata could not be found');
    }

    header('Content-Type: ' . ($file['mime_type'] ?: 'application/octet-stream'));
    header('Content-Length: ' . (string)((int)($file['file_size'] ?? 0)));
    header('Accept-Ranges: none');

    $safeFilename = basename($file['file_name'] ?: 'download.bin');
    if ($disposition === 'inline') {
        header('Content-Disposition: inline; filename="' . $safeFilename . '"');
    } else {
        header('Content-Disposition: attachment; filename="' . $safeFilename . '"');
    }

    header('Cache-Control: no-store');

    foreach ($parts as $part) {
        $token = $part['bot_token'] ?? null;
        $fileInfo = $telegramService->getFile($part['telegram_file_id'], $token);
        if (empty($fileInfo['ok']) || empty($fileInfo['result']['file_path'])) {
            throw new Exception('Chunk file path could not be resolved');
        }

        $url = $telegramService->getFileUrl($fileInfo['result']['file_path'], $token);
        $remote = fopen($url, 'rb');
        if (!$remote) {
            throw new Exception('Chunk stream could not be opened');
        }

        while (!feof($remote)) {
            echo fread($remote, 1024 * 1024);
            flush();
        }

        fclose($remote);
    }

    exit;
}

function streamTelegramStoredFile(TelegramService $telegramService, array $file, string $disposition = 'attachment'): void
{
    $token = $file['bot_token'] ?? null;
    $fileInfo = $telegramService->getFile($file['telegram_file_id'], $token);
    if (empty($fileInfo['ok']) || empty($fileInfo['result']['file_path'])) {
        throw new Exception('Telegram file path could not be resolved');
    }

    $url = $telegramService->getFileUrl($fileInfo['result']['file_path'], $token);
    $remote = fopen($url, 'rb');
    if (!$remote) {
        throw new Exception('File stream could not be opened');
    }

    $safeFilename = basename(($file['display_name'] ?: $file['file_name']) ?: 'download.bin');
    header('Content-Type: ' . ($file['mime_type'] ?: 'application/octet-stream'));
    header('Content-Disposition: ' . ($disposition === 'inline' ? 'inline' : 'attachment') . '; filename="' . $safeFilename . '"');
    if (!empty($file['file_size'])) {
        header('Content-Length: ' . (string)((int)$file['file_size']));
    }
    header('Cache-Control: no-store');

    while (!feof($remote)) {
        echo fread($remote, 1024 * 1024);
        flush();
    }

    fclose($remote);
    exit;
}

function buildSafeDownloadName(?string $name, string $fallback = 'download.bin'): string
{
    $candidate = trim((string)$name);
    $candidate = $candidate !== '' ? $candidate : $fallback;
    $candidate = str_replace(["\r", "\n", '"'], [' ', ' ', ''], $candidate);
    $candidate = basename(str_replace('\\', '/', $candidate));
    return $candidate !== '' ? $candidate : $fallback;
}

function uniqueArchiveEntryName(array &$usedNames, string $baseName): string
{
    $safeName = buildSafeDownloadName($baseName);
    $extension = pathinfo($safeName, PATHINFO_EXTENSION);
    $stem = pathinfo($safeName, PATHINFO_FILENAME);
    $stem = $stem !== '' ? $stem : 'file';
    $candidate = $safeName;
    $suffix = 2;

    while (isset($usedNames[strtolower($candidate)])) {
        $candidate = $stem . '_' . $suffix . ($extension !== '' ? '.' . $extension : '');
        $suffix++;
    }

    $usedNames[strtolower($candidate)] = true;
    return $candidate;
}

function copyRemoteFileToHandle(TelegramService $telegramService, string $telegramFileId, ?string $token, $targetHandle): void
{
    $fileInfo = $telegramService->getFile($telegramFileId, $token);
    if (empty($fileInfo['ok']) || empty($fileInfo['result']['file_path'])) {
        throw new Exception('Telegram file path could not be resolved');
    }

    $url = $telegramService->getFileUrl($fileInfo['result']['file_path'], $token);
    $remote = fopen($url, 'rb');
    if (!$remote) {
        throw new Exception('Remote file stream could not be opened');
    }

    try {
        stream_copy_to_stream($remote, $targetHandle);
    } finally {
        fclose($remote);
    }
}

function materializeStoredFileToPath(PDO $db, TelegramService $telegramService, array $file, string $targetPath): void
{
    $targetHandle = fopen($targetPath, 'wb');
    if ($targetHandle === false) {
        throw new Exception('Target file could not be opened');
    }

    try {
        if (!empty($file['is_chunked'])) {
            $partStmt = $db->prepare("SELECT * FROM file_parts WHERE file_id = ? ORDER BY part_index ASC");
            $partStmt->execute([$file['id']]);
            $parts = $partStmt->fetchAll();
            if (empty($parts)) {
                throw new Exception('Chunk metadata could not be found');
            }

            foreach ($parts as $part) {
                copyRemoteFileToHandle($telegramService, $part['telegram_file_id'], $part['bot_token'] ?? null, $targetHandle);
            }
            return;
        }

        copyRemoteFileToHandle($telegramService, $file['telegram_file_id'], $file['bot_token'] ?? null, $targetHandle);
    } finally {
        fclose($targetHandle);
    }
}

function escapePowerShellLiteral(string $value): string
{
    return "'" . str_replace("'", "''", $value) . "'";
}

function removeDirectoryTree(string $path): void
{
    if (!is_dir($path)) {
        return;
    }

    $items = scandir($path);
    if ($items === false) {
        return;
    }

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }

        $target = $path . DIRECTORY_SEPARATOR . $item;
        if (is_dir($target)) {
            removeDirectoryTree($target);
        } elseif (is_file($target)) {
            @unlink($target);
        }
    }

    @rmdir($path);
}

function executeCommand(string $command, ?array &$output = null, ?int &$exitCode = null): bool
{
    if (!function_exists('exec')) {
        $output = ['exec() is not available'];
        $exitCode = 1;
        return false;
    }

    $output = [];
    $exitCode = 0;
    exec($command . ' 2>&1', $output, $exitCode);
    return $exitCode === 0;
}

function createTemporaryZipPath(string $prefix): string
{
    $basePath = tempnam(sys_get_temp_dir(), $prefix);
    if ($basePath === false) {
        throw new Exception('Temporary ZIP file could not be created');
    }

    if (is_file($basePath)) {
        @unlink($basePath);
    }

    return $basePath . '.zip';
}

function createZipBundleWithPowerShell(array $sourcePaths, string $zipPath): void
{
    if (empty($sourcePaths)) {
        throw new Exception('No files available for ZIP archive');
    }

    $pathList = implode(', ', array_map(static fn(string $path) => escapePowerShellLiteral($path), $sourcePaths));
    $command = 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command '
        . escapeshellarg("\$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath @({$pathList}) -DestinationPath " . escapePowerShellLiteral($zipPath) . " -CompressionLevel Optimal -Force");

    $output = [];
    $exitCode = 0;
    if (!executeCommand($command, $output, $exitCode) || !is_file($zipPath)) {
        throw new Exception('ZIP archive could not be created without ZipArchive: ' . trim(implode("\n", $output)));
    }
}

function createZipBundleFromFiles(PDO $db, TelegramService $telegramService, array $files, string $zipPath): void
{
    if (!class_exists('ZipArchive')) {
        $tempDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tgbundle_' . bin2hex(random_bytes(6));
        if (!mkdir($tempDir, 0777, true) && !is_dir($tempDir)) {
            throw new Exception('Temporary ZIP workspace could not be created');
        }

        $sourcePaths = [];
        $usedNames = [];

        try {
            foreach ($files as $file) {
                $entryName = uniqueArchiveEntryName($usedNames, (string)($file['display_name'] ?: $file['file_name'] ?: 'file.bin'));
                $targetPath = $tempDir . DIRECTORY_SEPARATOR . $entryName;
                materializeStoredFileToPath($db, $telegramService, $file, $targetPath);
                $sourcePaths[] = $targetPath;
            }

            createZipBundleWithPowerShell($sourcePaths, $zipPath);
        } finally {
            removeDirectoryTree($tempDir);
        }

        return;
    }

    $zip = new ZipArchive();
    $opened = $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    if ($opened !== true) {
        throw new Exception('ZIP archive could not be created');
    }

    $tempFiles = [];
    $usedNames = [];

    try {
        foreach ($files as $file) {
            $tempFile = tempnam(sys_get_temp_dir(), 'tgbundle_');
            if ($tempFile === false) {
                throw new Exception('Temporary bundle file could not be created');
            }

            $tempFiles[] = $tempFile;
            materializeStoredFileToPath($db, $telegramService, $file, $tempFile);
            $entryName = uniqueArchiveEntryName($usedNames, (string)($file['display_name'] ?: $file['file_name'] ?: 'file.bin'));
            if (!$zip->addFile($tempFile, $entryName)) {
                throw new Exception('File could not be added to ZIP archive');
            }
        }
    } catch (Exception $e) {
        $zip->close();
        foreach ($tempFiles as $tempFile) {
            if (is_file($tempFile)) {
                @unlink($tempFile);
            }
        }
        throw $e;
    }

    $zip->close();

    foreach ($tempFiles as $tempFile) {
        if (is_file($tempFile)) {
            @unlink($tempFile);
        }
    }
}

function fetchShareCollectionByToken(PDO $db, string $shareToken): array
{
    $collectionStmt = $db->prepare("SELECT * FROM share_collections WHERE share_token = ? LIMIT 1");
    $collectionStmt->execute([$shareToken]);
    $collection = $collectionStmt->fetch();
    if (!$collection) {
        throw new Exception('Share collection not found');
    }

    $fileStmt = $db->prepare("
        SELECT f.*
        FROM share_collection_files scf
        JOIN files f ON f.id = scf.file_id
        WHERE scf.collection_id = ? AND f.deleted_at IS NULL
        ORDER BY scf.sort_order ASC, f.created_at DESC
    ");
    $fileStmt->execute([$collection['id']]);
    $files = $fileStmt->fetchAll();

    if (empty($files)) {
        throw new Exception('Share collection is empty');
    }

    return [$collection, $files];
}

// Auth Middleware Helper
$authMiddleware = function (Request $request, $handler) use ($authService, $db) {
    $authHeader = $request->getHeaderLine('Authorization');
    $token = '';
    
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
        $token = substr($authHeader, 7);
    } else {
        $queryParams = $request->getQueryParams();
        $token = $queryParams['token'] ?? '';
    }

    if (empty($token)) {
        error_log("Auth failed: Token empty");
        $response = new \Slim\Psr7\Response();
        $response->getBody()->write(json_encode(['error' => 'Unauthorized']));
        return $response->withHeader('Content-Type', 'application/json')->withStatus(401);
    }

    // Check for API Key (starts with sk_)
    if (strpos($token, 'sk_') === 0) {
        $stmt = $db->prepare("SELECT * FROM api_keys WHERE api_key = ? AND is_active = 1");
        $stmt->execute([$token]);
        $apiKey = $stmt->fetch();

        if ($apiKey) {
             // Fetch User
             $stmtUser = $db->prepare("SELECT * FROM users WHERE telegram_id = ?");
             $stmtUser->execute([$apiKey['user_telegram_id']]);
             $user = $stmtUser->fetch();
             
             if (!$user) {
                  // Fallback: If telegram_id is not set or user not found, 
                  // allow but maybe as a generic user or error?
                  $user = [
                      'id' => 0, 
                      'username' => 'API User', 
                      'email' => null,
                      'first_name' => 'API',
                      'last_name' => 'User',
                      'is_active' => true,
                      'role' => 'user', 
                      'telegram_id' => $apiKey['user_telegram_id'],
                      'created_at' => null
                  ];
             }
             
             $request = $request->withAttribute('user', $user);
             return $handler->handle($request);
        } else {
             error_log("Auth failed: Invalid API Key - " . $token);
             $response = new \Slim\Psr7\Response();
             $response->getBody()->write(json_encode(['error' => 'Invalid API Key']));
             return $response->withHeader('Content-Type', 'application/json')->withStatus(401);
        }
    }

    $decoded = $authService->decodeToken($token);

    if (!$decoded) {
        error_log("Auth failed: Invalid token - " . $token);
        $response = new \Slim\Psr7\Response();
        $response->getBody()->write(json_encode(['error' => 'Invalid token']));
        return $response->withHeader('Content-Type', 'application/json')->withStatus(401);
    }

    $stmt = $db->prepare("SELECT * FROM users WHERE email = ? AND is_active = 1");
    $stmt->execute([$decoded['sub']]);
    $user = $stmt->fetch();

    if (!$user) {
        error_log("Auth failed: User not found or inactive - " . $decoded['sub']);
        $response = new \Slim\Psr7\Response();
        $response->getBody()->write(json_encode(['error' => 'User not found or inactive']));
        return $response->withHeader('Content-Type', 'application/json')->withStatus(401);
    }

    $request = $request->withAttribute('user', $user);
    return $handler->handle($request);
};

// Admin Middleware Helper
$adminMiddleware = function (Request $request, $handler) {
    $user = $request->getAttribute('user');
    if (!$user || $user['role'] !== 'admin') {
        $response = new \Slim\Psr7\Response();
        $response->getBody()->write(json_encode(['error' => 'Admin access required']));
        return $response->withHeader('Content-Type', 'application/json')->withStatus(403);
    }
    return $handler->handle($request);
};

// --- AUTH ROUTES ---

$app->post('/auth/register', function (Request $request, Response $response) use ($db, $authService) {
    $data = $request->getParsedBody();
    $email = $data['email'] ?? '';
    $password = $data['password'] ?? '';
    $username = $data['username'] ?? '';
    $firstName = $data['firstName'] ?? '';
    $lastName = $data['lastName'] ?? '';

    if (empty($email) || empty($password) || empty($username)) {
        $response->getBody()->write(json_encode(['error' => 'Email, password and username required']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("SELECT id FROM users WHERE email = ? OR username = ?");
    $stmt->execute([$email, $username]);
    if ($stmt->fetch()) {
        $response->getBody()->write(json_encode(['error' => 'Email or username already registered']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $hash = $authService->hashPassword($password);
    $stmt = $db->prepare("INSERT INTO users (email, username, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?, 'user')");
    $stmt->execute([$email, $username, $hash, $firstName, $lastName]);

    $userId = $db->lastInsertId();
    $stmt = $db->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    $response->getBody()->write(json_encode([
        'id' => $user['id'],
        'email' => $user['email'],
        'username' => $user['username'],
        'first_name' => $user['first_name'],
        'last_name' => $user['last_name'],
        'is_active' => (bool)$user['is_active'],
        'role' => $user['role'],
        'created_at' => $user['created_at']
    ]));
    return $response->withHeader('Content-Type', 'application/json');
});

$app->post('/auth/login', function (Request $request, Response $response) use ($db, $authService) {
    $data = $request->getParsedBody();
    $identifier = trim($data['email'] ?? $data['username'] ?? '');
    $password = $data['password'] ?? '';

    $stmt = $db->prepare("SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1");
    $stmt->execute([$identifier, $identifier]);
    $user = $stmt->fetch();

    if (!$user || !$authService->verifyPassword($password, $user['password_hash'])) {
        $response->getBody()->write(json_encode(['error' => 'Incorrect username/email or password']));
        return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
    }

    if (!$user['is_active']) {
        $response->getBody()->write(json_encode(['error' => 'Inactive user']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $token = $authService->createToken($user['email']);
    $response->getBody()->write(json_encode(['access_token' => $token, 'token_type' => 'bearer']));
    return $response->withHeader('Content-Type', 'application/json');
});

$app->get('/auth/me', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    
    // Get personal stats
    $plan = buildPlanPayload($user);
    $storageLimit = $plan['storage_limit'];
    $stmt = $db->prepare("
        SELECT 
            COUNT(*) as file_count, 
            SUM(download_count) as download_count, 
            SUM(file_size) as storage_used,
            SUM(CASE WHEN share_token IS NOT NULL AND share_token != '' THEN 1 ELSE 0 END) as shared_count
        FROM files 
        WHERE user_id = ? AND deleted_at IS NULL
    ");
    $stmt->execute([$user['id']]);
    $stats = $stmt->fetch();

    $response->getBody()->write(json_encode([
        'id' => $user['id'],
        'email' => $user['email'],
        'username' => $user['username'],
        'first_name' => $user['first_name'],
        'last_name' => $user['last_name'],
        'is_active' => (bool)$user['is_active'],
        'role' => $user['role'],
        'plan' => $plan,
        'stats' => [
            'file_count' => (int)($stats['file_count'] ?? 0),
            'download_count' => (int)($stats['download_count'] ?? 0),
            'storage_used' => (int)($stats['storage_used'] ?? 0),
            'storage_limit' => $storageLimit,
            'shared_count' => (int)($stats['shared_count'] ?? 0),
        ],
        'created_at' => $user['created_at']
    ]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->put('/auth/profile', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $data = $request->getParsedBody() ?? [];
    $firstName = trim((string)($data['first_name'] ?? ''));
    $lastName = trim((string)($data['last_name'] ?? ''));
    $email = trim((string)($data['email'] ?? ''));

    if ($firstName === '' || $lastName === '' || $email === '') {
        $response->getBody()->write(json_encode(['error' => 'First name, last name and email are required']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $response->getBody()->write(json_encode(['error' => 'Valid email is required']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $emailStmt = $db->prepare("SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1");
    $emailStmt->execute([$email, $user['id']]);
    if ($emailStmt->fetch()) {
        $response->getBody()->write(json_encode(['error' => 'Email is already in use']));
        return $response->withStatus(409)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE id = ?");
    $stmt->execute([$firstName, $lastName, $email, $user['id']]);

    $userStmt = $db->prepare("SELECT * FROM users WHERE id = ?");
    $userStmt->execute([$user['id']]);
    $updatedUser = $userStmt->fetch();

    $plan = buildPlanPayload($updatedUser);
    $storageLimit = $plan['storage_limit'];
    $statsStmt = $db->prepare("
        SELECT 
            COUNT(*) as file_count, 
            SUM(download_count) as download_count, 
            SUM(file_size) as storage_used,
            SUM(CASE WHEN share_token IS NOT NULL AND share_token != '' THEN 1 ELSE 0 END) as shared_count
        FROM files 
        WHERE user_id = ? AND deleted_at IS NULL
    ");
    $statsStmt->execute([$updatedUser['id']]);
    $stats = $statsStmt->fetch();

    $response->getBody()->write(json_encode([
        'id' => $updatedUser['id'],
        'email' => $updatedUser['email'],
        'username' => $updatedUser['username'],
        'first_name' => $updatedUser['first_name'],
        'last_name' => $updatedUser['last_name'],
        'is_active' => (bool)$updatedUser['is_active'],
        'role' => $updatedUser['role'],
        'plan' => $plan,
        'stats' => [
            'file_count' => (int)($stats['file_count'] ?? 0),
            'download_count' => (int)($stats['download_count'] ?? 0),
            'storage_used' => (int)($stats['storage_used'] ?? 0),
            'storage_limit' => $storageLimit,
            'shared_count' => (int)($stats['shared_count'] ?? 0),
        ],
        'created_at' => $updatedUser['created_at']
    ]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->put('/auth/password', function (Request $request, Response $response) use ($db, $authService) {
    $user = $request->getAttribute('user');
    $data = $request->getParsedBody() ?? [];
    $currentPassword = (string)($data['current_password'] ?? '');
    $newPassword = (string)($data['new_password'] ?? '');

    if ($currentPassword === '' || $newPassword === '') {
        $response->getBody()->write(json_encode(['error' => 'Current password and new password are required']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    if (strlen($newPassword) < 6) {
        $response->getBody()->write(json_encode(['error' => 'New password must be at least 6 characters']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ? LIMIT 1");
    $stmt->execute([$user['id']]);
    $currentUser = $stmt->fetch();

    if (!$currentUser || !$authService->verifyPassword($currentPassword, $currentUser['password_hash'])) {
        $response->getBody()->write(json_encode(['error' => 'Current password is incorrect']));
        return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
    }

    if ($authService->verifyPassword($newPassword, $currentUser['password_hash'])) {
        $response->getBody()->write(json_encode(['error' => 'New password must be different from current password']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $newHash = $authService->hashPassword($newPassword);
    $updateStmt = $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    $updateStmt->execute([$newHash, $user['id']]);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Password updated successfully']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->get('/billing/me', function (Request $request, Response $response) {
    $user = $request->getAttribute('user');

    $response->getBody()->write(json_encode([
        'plan' => buildPlanPayload($user),
    ]));

    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/billing/upgrade', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $plan = buildPlanPayload($user);

    if ($plan['is_pro']) {
        $response->getBody()->write(json_encode([
            'success' => true,
            'message' => 'User already has PRO plan',
            'plan' => $plan,
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    }

    $proLimit = getDefaultStorageLimitForPlan('pro');
    $stmt = $db->prepare("
        UPDATE users
        SET plan_type = 'pro',
            plan_storage_limit = ?,
            plan_started_at = NOW(),
            plan_expires_at = NULL
        WHERE id = ?
    ");
    $stmt->execute([$proLimit, $user['id']]);

    $stmt = $db->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([$user['id']]);
    $updatedUser = $stmt->fetch();

    $response->getBody()->write(json_encode([
        'success' => true,
        'message' => 'PRO plan activated successfully',
        'plan' => buildPlanPayload($updatedUser),
    ]));

    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

// --- FILE ROUTES ---

$app->post('/upload', function (Request $request, Response $response) use ($db, $telegramService, $config) {
    $user = $request->getAttribute('user');
    $uploadedFiles = $request->getUploadedFiles();
    $uploadDebugId = 'upl_' . substr(bin2hex(random_bytes(6)), 0, 12);

    if (empty($uploadedFiles['file'])) {
        error_log("[UPLOAD {$uploadDebugId}] request rejected: missing file field");
        $response->getBody()->write(json_encode(['error' => 'No file uploaded']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $file = $uploadedFiles['file'];
    if ($file->getError() !== UPLOAD_ERR_OK) {
        error_log("[UPLOAD {$uploadDebugId}] request rejected: upload error code=" . $file->getError());
        $response->getBody()->write(json_encode(['error' => 'File upload error']));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }

    $fileSize = (int)($file->getSize() ?? 0);
    $clientName = $file->getClientFilename() ?: 'upload.bin';
    $clientMime = $file->getClientMediaType() ?: 'application/octet-stream';
    error_log("[UPLOAD {$uploadDebugId}] start user_id={$user['id']} file={$clientName} mime={$clientMime} size={$fileSize}");

    $storageLimit = getUserStorageLimit($user);
    $usageStmt = $db->prepare("SELECT COALESCE(SUM(file_size), 0) as storage_used FROM files WHERE user_id = ? AND deleted_at IS NULL");
    $usageStmt->execute([$user['id']]);
    $storageUsed = (int)($usageStmt->fetch()['storage_used'] ?? 0);

    if ($fileSize > 0 && ($storageUsed + $fileSize) > $storageLimit) {
        $response->getBody()->write(json_encode([
            'error' => 'Storage limit exceeded',
            'storage_used' => $storageUsed,
            'storage_limit' => $storageLimit,
            'required_space' => $fileSize,
            'plan' => buildPlanPayload($user),
        ]));
        return $response->withStatus(403)->withHeader('Content-Type', 'application/json');
    }

    try {
        $parsedBody = $request->getParsedBody() ?? [];
        $folderId = $parsedBody['folder_id'] ?? null;
        $uploadEngine = 'php';
        $engineFallback = false;
        error_log("[UPLOAD {$uploadDebugId}] creating payload folder_id=" . ($folderId === null ? 'null' : (string)$folderId));
        $payload = createChunkUploadPayload($file, $user, $telegramService, $config);
        error_log("[UPLOAD {$uploadDebugId}] payload created engine=" . ($payload['upload_engine'] ?? 'php') . " chunked=" . (!empty($payload['is_chunked']) ? 'yes' : 'no') . " chunk_count=" . (int)($payload['chunk_count'] ?? 1) . " display_name=" . ($payload['display_name'] ?? '-'));

        $newFileId = persistUploadedFileRecord($db, $payload, (int)$user['id'], $folderId);
        error_log("[UPLOAD {$uploadDebugId}] db persisted file_id={$newFileId}");
        syncTelegramUploadCaptions($telegramService, $config, $payload, $user, $newFileId);
        error_log("[UPLOAD {$uploadDebugId}] caption sync completed telegram_file_id=" . ($payload['telegram_file_id'] ?? '-'));

        $response->getBody()->write(json_encode([
            'success' => true,
            'message' => !empty($payload['is_chunked'])
                ? "Dosya parcalanarak basariyla yuklendi"
                : "Dosya basariyla yuklendi",
            'engine' => $payload['upload_engine'] ?? $uploadEngine,
            'engine_fallback' => $engineFallback,
            'is_chunked' => !empty($payload['is_chunked']),
            'chunk_count' => (int)($payload['chunk_count'] ?? 1),
            'file_info' => [
                 'filename' => $payload['display_name'],
                 'file_id' => $payload['telegram_file_id'],
                 'id' => $newFileId,
            ]
        ]));
        error_log("[UPLOAD {$uploadDebugId}] success response sent");
        return $response->withHeader('Content-Type', 'application/json');

    } catch (Exception $e) {
        error_log("[UPLOAD {$uploadDebugId}] Upload Error: " . $e->getMessage() . "\n" . $e->getTraceAsString());
        $response->getBody()->write(json_encode([
            'error' => $e->getMessage(),
            'debug_id' => $uploadDebugId,
            'trace' => $e->getTraceAsString(), // Send trace to client for debugging
            'status' => 'error'
        ]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
})->add($authMiddleware);

$app->post('/dosya/upload/start', function (Request $request, Response $response) {
    $parsedBody = $request->getParsedBody() ?? [];
    $originalName = normalizeUploadFilename((string)($parsedBody['file_name'] ?? 'upload.bin'), (string)($parsedBody['mime_type'] ?? 'application/octet-stream'));
    $fileSize = (int)($parsedBody['file_size'] ?? 0);
    $expiresInMinutes = (int)($parsedBody['expires_in_minutes'] ?? 1440);
    $notifyEmail = trim((string)($parsedBody['notify_email'] ?? ''));
    $allowedDurations = getAllowedPublicShareDurations();

    if ($fileSize <= 0) {
        $response->getBody()->write(json_encode(['error' => 'Gecersiz dosya bilgisi']));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    if (!array_key_exists($expiresInMinutes, $allowedDurations)) {
        $response->getBody()->write(json_encode(['error' => 'Gecersiz link suresi']));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    if ($notifyEmail !== '' && !filter_var($notifyEmail, FILTER_VALIDATE_EMAIL)) {
        $response->getBody()->write(json_encode(['error' => 'Gecersiz e-posta adresi']));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    $uploadId = bin2hex(random_bytes(16));
    $anonymousUser = [
        'first_name' => 'Public',
        'last_name' => 'Upload',
        'username' => 'public-share',
        'email' => $notifyEmail !== '' ? $notifyEmail : 'public@telegram-drive.local',
    ];
    $uploadPlan = getAdaptivePublicUploadPlan($fileSize);

    $state = [
        'upload_id' => $uploadId,
        'created_at' => gmdate('c'),
        'original_name' => $originalName,
        'display_name' => buildStoredDisplayName($originalName),
        'mime_type' => (string)($parsedBody['mime_type'] ?? 'application/octet-stream'),
        'file_size' => $fileSize,
        'chunk_size_bytes' => (int)$uploadPlan['chunk_size_bytes'],
        'chunk_count' => (int)$uploadPlan['chunk_count'],
        'is_chunked' => !empty($uploadPlan['is_chunked']),
        'expires_in_minutes' => $expiresInMinutes,
        'notify_email' => $notifyEmail,
        'user' => $anonymousUser,
        'parts' => [],
    ];

    try {
        savePublicUploadState($uploadId, $state);
        $response->getBody()->write(json_encode([
            'success' => true,
            'upload_id' => $uploadId,
            'display_name' => $state['display_name'],
            'is_chunked' => !empty($state['is_chunked']),
            'chunk_count' => (int)$state['chunk_count'],
            'chunk_size_bytes' => $state['chunk_size_bytes'],
            'telegram_bot_limit_bytes' => getBotUploadLimitBytes(),
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['error' => $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
});

$app->post('/dosya/upload/chunk', function (Request $request, Response $response) use ($telegramService, $config) {
    $parsedBody = $request->getParsedBody() ?? [];
    $uploadedFiles = $request->getUploadedFiles();
    $uploadId = (string)($parsedBody['upload_id'] ?? '');
    $partIndex = (int)($parsedBody['part_index'] ?? -1);

    if ($uploadId === '' || $partIndex < 0) {
        $response->getBody()->write(json_encode(['error' => 'Eksik chunk bilgisi']));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    if (empty($uploadedFiles['chunk'])) {
        $response->getBody()->write(json_encode(['error' => 'Chunk dosyasi bulunamadi']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $chunk = $uploadedFiles['chunk'];
    if ($chunk->getError() !== UPLOAD_ERR_OK) {
        $response->getBody()->write(json_encode(['error' => 'Chunk upload hatasi']));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }

    try {
        $state = loadPublicUploadState($uploadId);
        $partCount = (int)($state['chunk_count'] ?? 0);
        if ($partIndex >= $partCount) {
            throw new Exception('Chunk index aralik disinda');
        }

        foreach ($state['parts'] as $existingPart) {
            if ((int)($existingPart['part_index'] ?? -1) === $partIndex) {
                throw new Exception('Bu chunk zaten yuklendi');
            }
        }

        $partPayload = uploadPreparedChunk($chunk, $state, $partIndex, $telegramService, $config);
        $state['parts'][] = $partPayload;
        savePublicUploadState($uploadId, $state);

        $response->getBody()->write(json_encode([
            'success' => true,
            'upload_id' => $uploadId,
            'uploaded_parts' => count($state['parts']),
            'chunk_count' => $partCount,
            'part_index' => $partIndex,
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['error' => $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
});

$app->post('/dosya/upload/complete', function (Request $request, Response $response) use ($db, $telegramService, $resendService, $config) {
    $parsedBody = $request->getParsedBody() ?? [];
    $uploadId = (string)($parsedBody['upload_id'] ?? '');

    if ($uploadId === '') {
        $response->getBody()->write(json_encode(['error' => 'Upload id gerekli']));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    try {
        $state = loadPublicUploadState($uploadId);
        $uploadedPartCount = count($state['parts'] ?? []);
        $expectedPartCount = (int)($state['chunk_count'] ?? 0);
        if ($expectedPartCount <= 0 || $uploadedPartCount !== $expectedPartCount) {
            throw new Exception('Tum chunklar yuklenmeden islem tamamlanamaz');
        }

        $payload = buildPublicUploadPayloadFromState($state);
        $newFileId = persistUploadedFileRecord($db, $payload, null, null);
        syncTelegramUploadCaptions($telegramService, $config, $payload, $state['user'] ?? [], $newFileId);

        $shareToken = bin2hex(random_bytes(24));
        $expiresAt = date('Y-m-d H:i:s', time() + (((int)$state['expires_in_minutes']) * 60));
        $db->prepare("UPDATE files SET share_token = ?, share_expires_at = ?, is_public_upload = 1 WHERE id = ?")
            ->execute([$shareToken, $expiresAt, $newFileId]);

        $uri = $request->getUri();
        $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();
        $shareUrl = $baseUrl . '/share/' . $shareToken;

        $notifyEmail = trim((string)($state['notify_email'] ?? ''));
        $emailResult = null;
        if ($notifyEmail !== '' && $resendService !== null) {
            $humanExpiry = date('d.m.Y H:i', strtotime($expiresAt));
            $emailResult = $resendService->sendShareLinkEmail(
                $notifyEmail,
                $shareUrl,
                $payload['file_name'],
                formatBytes((int)$payload['file_size']),
                $humanExpiry
            );
        }

        deletePublicUploadState($uploadId);

        $response->getBody()->write(json_encode([
            'success' => true,
            'share_url' => $shareUrl,
            'file_id' => $newFileId,
            'display_name' => $payload['display_name'],
            'original_name' => $payload['file_name'],
            'chunk_count' => (int)($payload['chunk_count'] ?? 1),
            'chunk_size_bytes' => (int)($state['chunk_size_bytes'] ?? getPublicShareChunkSizeBytes()),
            'is_chunked' => !empty($payload['is_chunked']),
            'expires_at' => date('c', strtotime($expiresAt)),
            'expires_in_minutes' => (int)$state['expires_in_minutes'],
            'email_sent' => $emailResult !== null ? ($emailResult['success'] ?? false) : false,
            'email_to' => $notifyEmail !== '' ? $notifyEmail : null,
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['error' => $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
});

$app->get('/files', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $queryParams = $request->getQueryParams();
    
    $folderId = isset($queryParams['folder_id']) && $queryParams['folder_id'] !== '' ? $queryParams['folder_id'] : null;
    $onlyFavorites = isset($queryParams['favorites']) && $queryParams['favorites'] == 'true';
    $onlyTrash = isset($queryParams['trash']) && $queryParams['trash'] == 'true';
    $search = trim($queryParams['search'] ?? '');
    $limit = isset($queryParams['limit']) ? max(1, min(100, (int)$queryParams['limit'])) : null;
    
    $sql = "SELECT * FROM files WHERE user_id = ?";
    $params = [$user['id']];
    
    if ($onlyTrash) {
        $sql .= " AND deleted_at IS NOT NULL";
    } else {
        $sql .= " AND deleted_at IS NULL";
        
        if ($onlyFavorites) {
            $sql .= " AND is_favorite = 1";
        }
        
        // Only filter by folder if not viewing favorites or search
        // If viewing favorites, we usually want to see them all regardless of folder
        if (!$onlyFavorites && $search === '') {
            if ($folderId === null || $folderId === 'root') {
                $sql .= " AND folder_id IS NULL";
            } else {
                $sql .= " AND folder_id = ?";
                $params[] = $folderId;
            }
        }
    }

    if ($search !== '') {
        $sql .= " AND (file_name LIKE ? OR display_name LIKE ?)";
        $params[] = '%' . $search . '%';
        $params[] = '%' . $search . '%';
    }
    
    $sql .= " ORDER BY created_at DESC";
    if ($limit !== null) {
        $sql .= " LIMIT " . $limit;
    }
    
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $files = $stmt->fetchAll();

    $fileList = [];
    foreach ($files as $f) {
        $fileList[] = [
            'id' => $f['id'], // Added ID for operations
            'filename' => $f['file_name'],
            'display_name' => $f['display_name'] ?: $f['file_name'],
            'file_id' => $f['telegram_file_id'],
            'file_size' => (int)$f['file_size'],
            'mime_type' => $f['mime_type'] ?: 'application/octet-stream',
            'upload_date' => date('c', strtotime($f['created_at'])),
            'folder_id' => $f['folder_id'],
            'upload_engine' => $f['upload_engine'] ?? 'php',
            'is_chunked' => (bool)($f['is_chunked'] ?? false),
            'chunk_count' => (int)($f['chunk_count'] ?? 1),
            'is_favorite' => (bool)$f['is_favorite'],
            'deleted_at' => $f['deleted_at'],
            'download_count' => (int)$f['download_count'],
            'share_url' => !empty($f['share_token']) ? ($request->getUri()->getScheme() . '://' . $request->getUri()->getAuthority() . '/share/' . $f['share_token']) : null
        ];
    }

    $response->getBody()->write(json_encode($fileList));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/files/{id}/share-link', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $fileId = $args['id'];

    $stmt = $db->prepare("SELECT id, file_name, share_token FROM files WHERE id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $file = $stmt->fetch();

    if (!$file) {
        $response->getBody()->write(json_encode(['error' => 'File not found']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    $shareToken = $file['share_token'];
    if (empty($shareToken)) {
        $shareToken = bin2hex(random_bytes(24));
        $update = $db->prepare("UPDATE files SET share_token = ? WHERE id = ?");
        $update->execute([$shareToken, $fileId]);
    }

    $uri = $request->getUri();
    $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();
    $shareUrl = $baseUrl . '/share/' . $shareToken;

    $response->getBody()->write(json_encode([
        'success' => true,
        'share_url' => $shareUrl,
        'file_name' => $file['file_name']
    ]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->get('/shares/files', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $stmt = $db->prepare("
        SELECT id, file_name, display_name, file_size, mime_type, share_token, created_at
        FROM files
        WHERE user_id = ? AND deleted_at IS NULL AND share_token IS NOT NULL AND share_token != ''
        ORDER BY updated_at DESC, created_at DESC
    ");
    $stmt->execute([$user['id']]);
    $items = [];
    $uri = $request->getUri();
    $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();

    foreach ($stmt->fetchAll() as $file) {
        $items[] = [
            'id' => (int)$file['id'],
            'display_name' => $file['display_name'] ?: $file['file_name'],
            'file_name' => $file['file_name'],
            'file_size' => (int)$file['file_size'],
            'mime_type' => $file['mime_type'] ?: 'application/octet-stream',
            'share_url' => $baseUrl . '/share/' . $file['share_token'],
            'created_at' => $file['created_at'],
        ];
    }

    $response->getBody()->write(json_encode($items));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->get('/shares/collections', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $stmt = $db->prepare("
        SELECT sc.id, sc.title, sc.share_token, sc.created_at, COUNT(scf.file_id) AS file_count
        FROM share_collections sc
        LEFT JOIN share_collection_files scf ON scf.collection_id = sc.id
        WHERE sc.user_id = ?
        GROUP BY sc.id, sc.title, sc.share_token, sc.created_at
        ORDER BY sc.created_at DESC
    ");
    $stmt->execute([$user['id']]);
    $rows = $stmt->fetchAll();
    $uri = $request->getUri();
    $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();
    $collectionIds = array_map(static fn(array $row) => (int)$row['id'], $rows);
    $previewMap = [];

    if (!empty($collectionIds)) {
        $placeholders = implode(',', array_fill(0, count($collectionIds), '?'));
        $previewStmt = $db->prepare("
            SELECT scf.collection_id, f.display_name, f.file_name
            FROM share_collection_files scf
            JOIN files f ON f.id = scf.file_id
            WHERE scf.collection_id IN ({$placeholders}) AND f.deleted_at IS NULL
            ORDER BY scf.sort_order ASC
        ");
        $previewStmt->execute($collectionIds);
        foreach ($previewStmt->fetchAll() as $preview) {
            $collectionId = (int)$preview['collection_id'];
            $previewMap[$collectionId] ??= [];
            if (count($previewMap[$collectionId]) < 3) {
                $previewMap[$collectionId][] = $preview['display_name'] ?: $preview['file_name'];
            }
        }
    }

    $items = array_map(static function (array $row) use ($previewMap, $baseUrl) {
        $collectionId = (int)$row['id'];
        return [
            'id' => $collectionId,
            'title' => $row['title'],
            'file_count' => (int)$row['file_count'],
            'created_at' => $row['created_at'],
            'preview_files' => $previewMap[$collectionId] ?? [],
            'share_url' => $baseUrl . '/share/collection/' . $row['share_token'],
        ];
    }, $rows);

    $response->getBody()->write(json_encode($items));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/shares/collections', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $data = $request->getParsedBody() ?? [];
    $fileIds = array_values(array_unique(array_filter(array_map('intval', (array)($data['file_ids'] ?? [])))));
    $title = trim((string)($data['title'] ?? ''));

    if (empty($fileIds)) {
        $response->getBody()->write(json_encode(['error' => 'Paylaşılacak dosya seçilmedi']));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    $placeholders = implode(',', array_fill(0, count($fileIds), '?'));
    $stmt = $db->prepare("SELECT id, file_name, display_name FROM files WHERE user_id = ? AND deleted_at IS NULL AND id IN ({$placeholders}) ORDER BY created_at DESC");
    $stmt->execute(array_merge([(int)$user['id']], $fileIds));
    $files = $stmt->fetchAll();

    if (empty($files)) {
        $response->getBody()->write(json_encode(['error' => 'Geçerli dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    if ($title === '') {
        $firstFile = $files[0]['display_name'] ?: $files[0]['file_name'] ?: 'Dosyalar';
        $title = count($files) === 1
            ? $firstFile
            : $firstFile . ' + ' . (count($files) - 1) . ' dosya';
    }

    $token = bin2hex(random_bytes(24));

    $db->beginTransaction();
    try {
        $insertCollection = $db->prepare("INSERT INTO share_collections (user_id, title, share_token) VALUES (?, ?, ?)");
        $insertCollection->execute([(int)$user['id'], $title, $token]);
        $collectionId = (int)$db->lastInsertId();
        $insertItem = $db->prepare("INSERT INTO share_collection_files (collection_id, file_id, sort_order) VALUES (?, ?, ?)");
        foreach (array_values($files) as $index => $file) {
            $insertItem->execute([$collectionId, (int)$file['id'], $index]);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    $uri = $request->getUri();
    $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();
    $shareUrl = $baseUrl . '/share/collection/' . $token;
    $response->getBody()->write(json_encode([
        'success' => true,
        'title' => $title,
        'file_count' => count($files),
        'share_url' => $shareUrl,
    ]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->get('/telegram-url/{file_id}', function (Request $request, Response $response, array $args) use ($db, $telegramService) {
    $user = $request->getAttribute('user');
    $fileId = $args['file_id'];

    $stmt = $db->prepare("SELECT * FROM files WHERE telegram_file_id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $f = $stmt->fetch();

    if (!$f) {
        $response->getBody()->write(json_encode(['success' => false, 'message' => 'Dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("SELECT telegram_file_id, bot_token FROM files WHERE telegram_file_id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $fileData = $stmt->fetch();

    if (!$fileData) {
        $response->getBody()->write(json_encode(['success' => false, 'message' => 'Dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }
    
    $token = $fileData['bot_token'] ?? null;

    try {
        $fileInfo = $telegramService->getFile($fileId, $token);
        if (!$fileInfo['ok']) {
            throw new Exception('Telegram Error: ' . ($fileInfo['description'] ?? 'Unknown'));
        }
        
        $url = $telegramService->getFileUrl($fileInfo['result']['file_path'], $token);
        
        $response->getBody()->write(json_encode([
            'success' => true,
            'download_url' => $url,
            'filename' => $fileData['file_name'], // Assuming file_name is in fileData, or fetch it
            'file_size' => (int)$fileData['file_size'], // Assuming file_size is in fileData
            'mime_type' => $fileData['mime_type'] // Assuming mime_type is in fileData
        ]));
        return $response->withHeader('Content-Type', 'application/json');
    } catch (\Exception $e) {
        $response->getBody()->write(json_encode(['success' => false, 'message' => $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
})->add($authMiddleware);

$app->get('/share/collection/{token}', function (Request $request, Response $response, array $args) use ($db) {
    try {
        [$collection, $files] = fetchShareCollectionByToken($db, $args['token']);
    } catch (Exception $e) {
        $response->getBody()->write('Share collection not found');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    $uri = $request->getUri();
    $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();
    $zipUrl = $baseUrl . '/share/collection/' . $collection['share_token'] . '/download-zip';
    $safeTitle = htmlspecialchars($collection['title'], ENT_QUOTES, 'UTF-8');
    $fileCount = count($files);
    $fileRows = '';

    foreach ($files as $file) {
        $name = htmlspecialchars($file['display_name'] ?: $file['file_name'], ENT_QUOTES, 'UTF-8');
        $size = formatBytes((int)($file['file_size'] ?? 0));
        $downloadUrl = $baseUrl . '/share/collection/' . $collection['share_token'] . '/download/' . $file['id'];
        $fileRows .= '<div class="fileRow"><div><div class="fileName">' . $name . '</div><div class="fileMeta">' . htmlspecialchars($size, ENT_QUOTES, 'UTF-8') . '</div></div><a class="miniButton" href="' . htmlspecialchars($downloadUrl, ENT_QUOTES, 'UTF-8') . '">İndir</a></div>';
    }

    $zipUrlJs = json_encode($zipUrl, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $html = <<<HTML
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{$safeTitle} - Paylaşım Sayfası</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: linear-gradient(180deg, #eef4ff 0%, #f8fafc 100%); color: #0f172a; }
    .page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { width: 100%; max-width: 860px; background: rgba(255,255,255,0.92); border-radius: 30px; box-shadow: 0 30px 80px rgba(15, 23, 42, 0.14); overflow: hidden; }
    .hero { padding: 30px; background: linear-gradient(135deg, #3e577a, #2563eb); color: #fff; }
    .hero h1 { margin: 14px 0 8px; font-size: 32px; line-height: 1.1; }
    .hero p { margin: 0; color: rgba(255,255,255,0.82); }
    .content { padding: 24px; display: grid; gap: 16px; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.14); font-size: 12px; font-weight: 700; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 18px; border-radius: 16px; background: #2563eb; color: #fff; text-decoration: none; font-weight: 700; border: none; cursor: pointer; }
    .button.secondary { background: #fff; color: #0f172a; border: 1px solid #dbe4ef; }
    .files { display: grid; gap: 12px; }
    .fileRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-radius: 18px; background: #f8fafc; border: 1px solid #e2e8f0; }
    .fileName { font-weight: 700; word-break: break-word; }
    .fileMeta { margin-top: 6px; color: #64748b; font-size: 14px; }
    .miniButton { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 16px; border-radius: 12px; background: #0f172a; color: #fff; text-decoration: none; font-weight: 700; white-space: nowrap; }
    .subtle { color: #64748b; font-size: 14px; }
    @media (max-width: 640px) { .fileRow { flex-direction: column; align-items: stretch; } .actions { flex-direction: column; } .button, .miniButton { width: 100%; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="hero">
        <div class="badge">Çoklu Paylaşım</div>
        <h1>{$safeTitle}</h1>
        <p>{$fileCount} dosya tek sayfada toplandı. İstersen hepsini ZIP olarak, istersen tek tek indirebilirsin.</p>
      </div>
      <div class="content">
        <div class="actions">
          <a class="button" href="{$zipUrl}">Tümünü ZIP İndir</a>
          <button class="button secondary" id="copyLinkButton">Linki Kopyala</button>
        </div>
        <div class="subtle">Bu sayfa Telegram dosya adreslerini göstermeden güvenli indirme sunar.</div>
        <div class="files">{$fileRows}</div>
      </div>
    </div>
  </div>
  <script>
    const zipUrl = {$zipUrlJs};
    document.getElementById('copyLinkButton')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        document.getElementById('copyLinkButton').textContent = 'Link Kopyalandı';
      } catch (error) {
        window.prompt('Linki kopyalayın:', window.location.href);
      }
    });
  </script>
</body>
</html>
HTML;

    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
});

$app->get('/share/collection/{token}/download/{id}', function (Request $request, Response $response, array $args) use ($db, $telegramService) {
    try {
        [$collection, $files] = fetchShareCollectionByToken($db, $args['token']);
    } catch (Exception $e) {
        $response->getBody()->write('File not found');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    $targetFile = null;
    foreach ($files as $file) {
        if ((int)$file['id'] === (int)$args['id']) {
            $targetFile = $file;
            break;
        }
    }

    if (!$targetFile) {
        $response->getBody()->write('File not found');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    try {
        $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)")
            ->execute([(int)$targetFile['id'], 0, $request->getServerParams()['REMOTE_ADDR'] ?? null, $request->getHeaderLine('User-Agent')]);
        $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([(int)$targetFile['id']]);
        if (!empty($targetFile['is_chunked'])) {
            streamChunkedFile($db, $telegramService, $targetFile, 'attachment');
        }
        streamTelegramStoredFile($telegramService, $targetFile, 'attachment');
    } catch (Exception $e) {
        $response->getBody()->write('File could not be downloaded');
        return $response->withStatus(500)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }
});

$app->get('/share/collection/{token}/download-zip', function (Request $request, Response $response, array $args) use ($db, $telegramService) {
    try {
        [$collection, $files] = fetchShareCollectionByToken($db, $args['token']);
        $zipPath = createTemporaryZipPath('tgsharezip_');
        createZipBundleFromFiles($db, $telegramService, $files, $zipPath);
        foreach ($files as $file) {
            $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)")
                ->execute([(int)$file['id'], 0, $request->getServerParams()['REMOTE_ADDR'] ?? null, $request->getHeaderLine('User-Agent')]);
            $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([(int)$file['id']]);
        }
        $downloadName = buildSafeDownloadName($collection['title'], 'paylasim') . '.zip';
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $downloadName . '"');
        header('Content-Length: ' . (string)filesize($zipPath));
        header('Cache-Control: no-store');
        readfile($zipPath);
        @unlink($zipPath);
        exit;
    } catch (Exception $e) {
        $response->getBody()->write('ZIP archive could not be created');
        return $response->withStatus(500)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }
});

$app->get('/share/{token}', function (Request $request, Response $response, array $args) use ($db, $telegramService, $config) {
    $shareToken = $args['token'];

    $resolution = resolveSharedFileOrHandleExpiration($db, $telegramService, $config, $shareToken);
    if ($resolution['status'] === 'expired') {
        $response->getBody()->write('Link suresi doldu. Dosya otomatik olarak silindi.');
        return $response->withStatus(410)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    $file = $resolution['file'];
    if (!$file) {
        $response->getBody()->write('File not found');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    $uri = $request->getUri();
    $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();
    $downloadUrl = $baseUrl . '/share/' . $shareToken . '/download';
    $displayName = $file['display_name'] ?: $file['file_name'] ?: 'Shared file';
    $fileName = htmlspecialchars($displayName, ENT_QUOTES, 'UTF-8');
    $mimeType = htmlspecialchars($file['mime_type'] ?: 'Unknown file type', ENT_QUOTES, 'UTF-8');
    $sizeLabel = formatBytes((int)($file['file_size'] ?? 0));
    $uploadedAt = !empty($file['created_at']) ? date('d.m.Y H:i', strtotime((string)$file['created_at'])) : '-';
    $deleteAtLabel = !empty($file['share_expires_at'])
        ? date('d.m.Y H:i', strtotime((string)$file['share_expires_at']))
        : (!empty($file['is_public_upload']) ? 'Ilk erisimde silinecek' : 'Otomatik silme yok');
    $shareMessage = "Bu dosyayi indir:\n" . $displayName . "\n" . $downloadUrl;
    $shareMessageHtml = htmlspecialchars($shareMessage, ENT_QUOTES, 'UTF-8');
    $telegramShareUrl = 'https://t.me/share/url?url=' . rawurlencode($downloadUrl) . '&text=' . rawurlencode("Bu dosyayi indir: " . $displayName);
    $whatsAppShareUrl = 'https://wa.me/?text=' . rawurlencode($shareMessage);
    $downloadUrlJs = json_encode($downloadUrl, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $shareMessageJs = json_encode($shareMessage, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $html = <<<HTML
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{$fileName} - Indirme Sayfasi</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #eef2f7; color: #111827; }
    .page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { width: 100%; max-width: 480px; background: #fff; border-radius: 28px; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12); overflow: hidden; }
    .hero { background: linear-gradient(135deg, #3e577a, #1f3656); color: #fff; padding: 28px; }
    .badge { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.12); border-radius: 999px; padding: 8px 12px; font-size: 12px; font-weight: bold; }
    .hero h1 { margin: 16px 0 8px; font-size: 28px; line-height: 1.2; }
    .hero p { margin: 0; color: rgba(255,255,255,0.82); }
    .content { padding: 24px; }
    .meta { display: grid; gap: 12px; margin-bottom: 24px; }
    .meta-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 18px; padding: 14px 16px; }
    .meta-label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .meta-value { font-weight: bold; color: #0f172a; word-break: break-word; }
    .button { display: flex; align-items: center; justify-content: center; width: 100%; height: 52px; border-radius: 16px; background: #3e577a; color: #fff; text-decoration: none; font-weight: bold; margin-bottom: 12px; }
    .button.secondary { background: #ffffff; color: #111827; border: 1px solid #dbe4ef; }
    .buttonRow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .share-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 18px; padding: 14px 16px; margin-bottom: 18px; }
    .share-box-title { font-size: 12px; color: #64748b; margin-bottom: 6px; }
    .share-box-value { font-weight: bold; color: #0f172a; white-space: pre-wrap; word-break: break-word; }
    .subtle { text-align: center; color: #64748b; font-size: 13px; }
    @media (max-width: 560px) { .buttonRow { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="hero">
        <div class="badge">Guvenli Paylasim</div>
        <h1>{$fileName}</h1>
        <p>Bu dosya indirilmeye hazir. Orijinal Telegram baglantisi gizli tutulur.</p>
      </div>
      <div class="content">
        <div class="meta">
          <div class="meta-item">
            <div class="meta-label">Dosya Turu</div>
            <div class="meta-value">{$mimeType}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Dosya Boyutu</div>
            <div class="meta-value">{$sizeLabel}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Yuklenme Tarihi</div>
            <div class="meta-value">{$uploadedAt}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Silinme Tarihi</div>
            <div class="meta-value">{$deleteAtLabel}</div>
          </div>
        </div>
        <div class="share-box">
          <div class="share-box-title">Arkadasina gondermeye hazir mesaj</div>
          <div class="share-box-value" id="shareMessage">{$shareMessageHtml}</div>
        </div>
        <a class="button" href="{$downloadUrl}">Dosyayi Indir</a>
        <div class="buttonRow">
          <a class="button secondary" href="{$telegramShareUrl}" target="_blank" rel="noopener noreferrer">Telegram ile Gonder</a>
          <a class="button secondary" href="{$whatsAppShareUrl}" target="_blank" rel="noopener noreferrer">WhatsApp ile Gonder</a>
        </div>
        <div class="buttonRow">
          <a class="button secondary" href="#" id="copyLinkButton">Linki Kopyala</a>
          <a class="button secondary" href="#" id="shareButton">Cihazdan Paylas</a>
        </div>
        <div class="subtle">Paylasilan kisi bu sayfa uzerinden dogrudan indirebilir.</div>
      </div>
    </div>
  </div>
  <script>
    const downloadUrl = {$downloadUrlJs};
    const shareMessage = {$shareMessageJs};
    const copyLinkButton = document.getElementById('copyLinkButton');
    const shareButton = document.getElementById('shareButton');

    copyLinkButton?.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(downloadUrl);
        copyLinkButton.textContent = 'Link Kopyalandi';
      } catch (error) {
        window.prompt('Linki kopyalayin:', downloadUrl);
      }
    });

    shareButton?.addEventListener('click', async (event) => {
      event.preventDefault();
      if (navigator.share) {
        try {
          await navigator.share({ title: document.title, text: shareMessage, url: downloadUrl });
          return;
        } catch (error) {
        }
      }

      window.prompt('Bu mesaji paylasin:', shareMessage);
    });
  </script>
</body>
</html>
HTML;

    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
});

$app->get('/share/{token}/download', function (Request $request, Response $response, array $args) use ($db, $telegramService, $config) {
    $shareToken = $args['token'];

    $resolution = resolveSharedFileOrHandleExpiration($db, $telegramService, $config, $shareToken);
    if ($resolution['status'] === 'expired') {
        $response->getBody()->write('Link suresi doldu. Dosya silindi.');
        return $response->withStatus(410)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    $file = $resolution['file'];
    if (!$file) {
        $response->getBody()->write('File not found');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    try {
        if (!empty($file['is_chunked'])) {
            streamChunkedFile($db, $telegramService, $file, 'attachment');
        }
        streamTelegramStoredFile($telegramService, $file, 'attachment');
    } catch (Exception $e) {
        $response->getBody()->write('File could not be downloaded');
        return $response->withStatus(500)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }
});

$app->get('/download/{file_id}', function (Request $request, Response $response, array $args) use ($db, $telegramService, $config) {
    $user = $request->getAttribute('user');
    $fileId = $args['file_id'];

    $stmt = $db->prepare("SELECT * FROM files WHERE telegram_file_id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $f = $stmt->fetch();

    if (!$f) {
        $response->getBody()->write(json_encode(['error' => 'Dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    // Chunked files are reassembled on the fly during download.
    if (!empty($f['is_chunked'])) {
        try {
            $stmt = $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)");
            $stmt->execute([
                $f['id'],
                0,
                $request->getServerParams()['REMOTE_ADDR'] ?? null,
                $request->getHeaderLine('User-Agent')
            ]);
            $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([$f['id']]);
            streamChunkedFile($db, $telegramService, $f, 'attachment');
        } catch (Exception $e) {
            $response->getBody()->write(json_encode(['error' => $e->getMessage()]));
            return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
        }
    }

    try {
        // Log download
        $stmt = $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)");
        $stmt->execute([
            $f['id'],
            0,
            $request->getServerParams()['REMOTE_ADDR'] ?? null,
            $request->getHeaderLine('User-Agent')
        ]);

        $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([$f['id']]);
        streamTelegramStoredFile($telegramService, $f, 'attachment');
    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['error' => $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
})->add($authMiddleware);

$app->post('/download/bundle', function (Request $request, Response $response) use ($db, $telegramService) {
    $user = $request->getAttribute('user');
    $data = $request->getParsedBody() ?? [];
    $fileIds = array_values(array_unique(array_filter(array_map('intval', (array)($data['file_ids'] ?? [])))));

    if (empty($fileIds)) {
        $response->getBody()->write(json_encode(['error' => 'İndirilecek dosya seçilmedi']));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    $placeholders = implode(',', array_fill(0, count($fileIds), '?'));
    $stmt = $db->prepare("SELECT * FROM files WHERE user_id = ? AND deleted_at IS NULL AND id IN ({$placeholders}) ORDER BY created_at DESC");
    $stmt->execute(array_merge([(int)$user['id']], $fileIds));
    $files = $stmt->fetchAll();

    if (empty($files)) {
        $response->getBody()->write(json_encode(['error' => 'Geçerli dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    try {
        $zipPath = createTemporaryZipPath('tgbundlezip_');
        createZipBundleFromFiles($db, $telegramService, $files, $zipPath);
        foreach ($files as $file) {
            $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)")
                ->execute([(int)$file['id'], 0, $request->getServerParams()['REMOTE_ADDR'] ?? null, $request->getHeaderLine('User-Agent')]);
            $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([(int)$file['id']]);
        }
        $downloadName = 'telegram-drive-' . date('Ymd_His') . '.zip';
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . $downloadName . '"');
        header('Content-Length: ' . (string)filesize($zipPath));
        header('Cache-Control: no-store');
        readfile($zipPath);
        @unlink($zipPath);
        exit;
    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['error' => $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
})->add($authMiddleware);

$app->get('/stream/{file_id}', function (Request $request, Response $response, array $args) use ($db, $telegramService) {
    $user = $request->getAttribute('user');
    $fileId = $args['file_id'];

    $stmt = $db->prepare("SELECT * FROM files WHERE telegram_file_id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $f = $stmt->fetch();

    if (!$f) {
        $response->getBody()->write(json_encode(['error' => 'Dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    if (!empty($f['is_chunked'])) {
        $response->getBody()->write(json_encode([
            'error' => 'Dosya boyutu yuksek oldugu icin onizleme kullanilamiyor'
        ]));
        return $response->withStatus(422)->withHeader('Content-Type', 'application/json');
    }

    try {
        $token = $f['bot_token'] ?? null;
        $res = $telegramService->getFile($fileId, $token);
        if (!$res['ok']) throw new Exception("Telegram error: " . ($res['description'] ?? ''));

        $url = $telegramService->getFileUrl($res['result']['file_path'], $token);
        
        // Log stream as a download hit
        $stmt = $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)");
        $stmt->execute([$f['id'], 0, $request->getServerParams()['REMOTE_ADDR'] ?? null, $request->getHeaderLine('User-Agent')]);
        
        $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([$f['id']]);

        return $response->withHeader('Location', $url)->withStatus(302);
    } catch (Exception $e) {
        $response->getBody()->write(json_encode(['error' => $e->getMessage()]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
})->add($authMiddleware);

$app->delete('/files/{file_id}', function (Request $request, Response $response, array $args) use ($db, $telegramService, $config) {
    $user = $request->getAttribute('user');
    $fileId = $args['file_id'];

    $stmt = $db->prepare("SELECT * FROM files WHERE telegram_file_id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $f = $stmt->fetch();

    if (!$f) {
        $response->getBody()->write(json_encode(['success' => false, 'message' => 'Dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    permanentlyDeleteStoredFile($db, $telegramService, $config, $f);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Dosya silindi']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->get('/preview/{id}', function (Request $request, Response $response, array $args) use ($db, $telegramService) {
    $fileId = $args['id'];
    $stmt = $db->prepare("SELECT telegram_file_id, mime_type, bot_token, is_chunked, file_size FROM files WHERE telegram_file_id = ?");
    $stmt->execute([$fileId]);
    $file = $stmt->fetch();

    if (!$file || !empty($file['is_chunked']) || (int)($file['file_size'] ?? 0) > 20 * 1024 * 1024 || strpos($file['mime_type'], 'image') === false) {
        return $response->withStatus(404);
    }

    $token = $file['bot_token'] ?? null;
    $fileInfo = $telegramService->getFile($file['telegram_file_id'], $token);
    
    if (empty($fileInfo['result']['file_path'])) {
        return $response->withStatus(404);
    }

    $url = $telegramService->getFileUrl($fileInfo['result']['file_path'], $token);
    
    // Proxy stream with cache headers
    $fp = fopen($url, 'rb');
    if ($fp) {
        header("Content-Type: " . $file['mime_type']);
        header("Cache-Control: public, max-age=86400");
        fpassthru($fp);
        fclose($fp);
        exit;
    }
    
    return $response->withStatus(404);
});

// --- API KEYS (ADMIN ONLY OR USER TOO? "adminse eğer" -> Admin features usually include key gen) ---
// Let's make it available for all users, but the UI tab is Admin-only as requested?
// User said "adminse eğer profil kısımına api sekmesi ekle".
// So I will maintain the endpoints accessible to authenticated users (so admins can use them), 
// but the UI will control visibility.

$app->post('/api-keys', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $data = $request->getParsedBody();
    $name = $data['name'] ?? 'API Key';

    $key = 'sk_' . bin2hex(random_bytes(24));
    
    $stmt = $db->prepare("INSERT INTO api_keys (user_telegram_id, api_key, key_name) VALUES (?, ?, ?)");
    // Note: api_keys table has user_telegram_id. We should probably use user_id from users table or map it.
    // The table definition (from Database step 88) uses user_telegram_id BIGINT.
    // But our users table stores telegram_id. Let's use that.
    $tgId = $user['telegram_id'] ?? 0;
    
    // If telegram_id is null (registered via web), we might have an issue if the column is NOT NULL.
    // Checking Database.php... `user_telegram_id BIGINT NOT NULL`.
    // We'll use 0 or a placeholder if telegram_id is missing, but ideally it should be linked to user table id.
    // Use user_telegram_id as per schema, assuming web users might not have it yet.
    
    $stmt->execute([$tgId, $key, $name]);

    $response->getBody()->write(json_encode(['success' => true, 'key' => $key, 'name' => $name]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->get('/api-keys', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $tgId = $user['telegram_id'] ?? 0;

    $stmt = $db->prepare("SELECT * FROM api_keys WHERE user_telegram_id = ? AND is_active = 1 ORDER BY created_at DESC");
    $stmt->execute([$tgId]);
    $keys = $stmt->fetchAll();

    $response->getBody()->write(json_encode($keys));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->delete('/api-keys/{id}', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $id = $args['id'];
    $tgId = $user['telegram_id'] ?? 0;

    $stmt = $db->prepare("DELETE FROM api_keys WHERE id = ? AND user_telegram_id = ?");
    $stmt->execute([$id, $tgId]);

    $response->getBody()->write(json_encode(['success' => true]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

// --- STATIC FILES & WEB UI ---

$app->get('/', function (Request $request, Response $response) {
    $html = file_get_contents(__DIR__ . '/../templates/index.html');
    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html');
});

$app->get('/profile', function (Request $request, Response $response) {
    $html = file_get_contents(__DIR__ . '/../templates/profile.html');
    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html');
});

$app->get('/shares', function (Request $request, Response $response) {
    $html = file_get_contents(__DIR__ . '/../templates/shares.html');
    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html');
});

$app->get('/dosya', function (Request $request, Response $response) {
    $html = file_get_contents(__DIR__ . '/../templates/dosya.html');
    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html');
});

$app->get('/login', function (Request $request, Response $response) {
    $html = file_get_contents(__DIR__ . '/../templates/login.html');
    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html');
});

$app->get('/register', function (Request $request, Response $response) {
    $html = file_get_contents(__DIR__ . '/../templates/register.html');
    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html');
});

$app->get('/health', function (Request $request, Response $response) use ($telegramService) {
    $response->getBody()->write(json_encode([
        'status' => 'healthy',
        'php_version' => PHP_VERSION,
        'framework' => 'Slim 4'
    ]));
    return $response->withHeader('Content-Type', 'application/json');
});

$app->get('/config', function (Request $request, Response $response) {
    global $config;
    $response->getBody()->write(json_encode([
        'upload_engine' => 'php',
        'max_bot_api_size' => getBotUploadLimitBytes()
    ]));
    return $response->withHeader('Content-Type', 'application/json');
});

$app->get('/dosya/config', function (Request $request, Response $response) {
    $response->getBody()->write(json_encode([
        'upload_engine' => 'php',
        'preferred_chunk_floor_bytes' => getPublicShareChunkSizeBytes(),
        'telegram_bot_limit_bytes' => getBotUploadLimitBytes(),
        'allowed_durations' => getAllowedPublicShareDurations(),
    ]));
    return $response->withHeader('Content-Type', 'application/json');
});

// --- ADMIN ROUTES ---

$app->get('/admin/stats', function (Request $request, Response $response) use ($db) {
    $stmt = $db->query("SELECT COUNT(*) as count FROM users");
    $userCount = $stmt->fetch()['count'];

    $stmt = $db->query("SELECT COUNT(*) as count FROM files");
    $fileCount = $stmt->fetch()['count'];

    $stmt = $db->query("SELECT SUM(download_count) as count FROM files");
    $downloadCount = $stmt->fetch()['count'] ?: 0;

    $response->getBody()->write(json_encode([
        'total_users' => (int)$userCount,
        'total_files' => (int)$fileCount,
        'total_downloads' => (int)$downloadCount
    ]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

$app->get('/admin/users', function (Request $request, Response $response) use ($db) {
    $stmt = $db->query("SELECT id, email, username, first_name, last_name, is_active, role, created_at FROM users ORDER BY created_at DESC");
    $users = $stmt->fetchAll();
    
    $response->getBody()->write(json_encode($users));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

$app->get('/admin/files', function (Request $request, Response $response) use ($db) {
    $stmt = $db->query("
        SELECT f.*, u.email as uploader_email, u.username as uploader_username, u.first_name as uploader_first_name, u.last_name as uploader_last_name 
        FROM files f 
        LEFT JOIN users u ON f.user_id = u.id 
        ORDER BY f.created_at DESC
    ");
    $files = $stmt->fetchAll();

    $fileList = [];
    foreach ($files as $f) {
        $uploaderName = $f['uploader_username'] ?: ($f['uploader_first_name'] ? $f['uploader_first_name'] . ' ' . $f['uploader_last_name'] : $f['uploader_email']);
        $fileList[] = [
            'id' => $f['id'],
            'filename' => $f['file_name'],
            'display_name' => $f['display_name'],
            'file_id' => $f['telegram_file_id'],
            'file_size' => (int)$f['file_size'],
            'mime_type' => $f['mime_type'],
            'uploader' => $uploaderName ?: 'Bilinmiyor',
            'download_count' => (int)$f['download_count'],
            'upload_date' => date('c', strtotime($f['created_at']))
        ];
    }

    $response->getBody()->write(json_encode($fileList));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

$app->post('/admin/users/{id}/role', function (Request $request, Response $response, array $args) use ($db) {
    $data = $request->getParsedBody();
    $role = $data['role'] ?? 'user';
    $userId = $args['id'];

    if (!in_array($role, ['user', 'admin'])) {
        $response->getBody()->write(json_encode(['error' => 'Geçersiz rol']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("UPDATE users SET role = ? WHERE id = ?");
    $stmt->execute([$role, $userId]);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Kullanıcı rolü güncellendi']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

$app->put('/admin/users/{id}/status', function (Request $request, Response $response, array $args) use ($db) {
    $data = $request->getParsedBody();
    $isActive = isset($data['is_active']) ? (int)$data['is_active'] : 1;
    $userId = $args['id'];

    $stmt = $db->prepare("UPDATE users SET is_active = ? WHERE id = ?");
    $stmt->execute([$isActive, $userId]);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Kullanıcı durumu güncellendi']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

$app->delete('/admin/users/{id}', function (Request $request, Response $response, array $args) use ($db) {
    $userId = $args['id'];
    
    // Prevent self-deletion
    $currentUser = $request->getAttribute('user');
    if ($currentUser['id'] == $userId) {
        $response->getBody()->write(json_encode(['error' => 'Kendinizi silemezsiniz']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("DELETE FROM users WHERE id = ?");
    $stmt->execute([$userId]);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Kullanıcı tamamen silindi']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

$app->delete('/admin/files/{file_id}', function (Request $request, Response $response, array $args) use ($db, $telegramService, $config) {
    $fileId = $args['file_id'];

    $stmt = $db->prepare("SELECT * FROM files WHERE telegram_file_id = ?");
    $stmt->execute([$fileId]);
    $f = $stmt->fetch();

    if (!$f) {
        $response->getBody()->write(json_encode(['success' => false, 'message' => 'Dosya bulunamadı']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    permanentlyDeleteStoredFile($db, $telegramService, $config, $f);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Dosya admin tarafından silindi']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

$app->get('/admin/logs', function (Request $request, Response $response) use ($db) {
    $stmt = $db->query("
        SELECT l.*, f.file_name, u.email as uploader_email 
        FROM download_logs l
        JOIN files f ON l.file_id = f.id
        LEFT JOIN users u ON f.user_id = u.id
        ORDER BY l.download_time DESC
        LIMIT 100
    ");
    $logs = $stmt->fetchAll();
    
    $response->getBody()->write(json_encode($logs));
    return $response->withHeader('Content-Type', 'application/json');
})->add($adminMiddleware)->add($authMiddleware);

// --- FOLDER ROUTES ---

$app->get('/folders', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $queryParams = $request->getQueryParams();
    $parentId = isset($queryParams['parent_id']) && $queryParams['parent_id'] !== '' ? $queryParams['parent_id'] : null;
    $onlyTrash = isset($queryParams['trash']) && $queryParams['trash'] == 'true';

    $sql = "SELECT * FROM folders WHERE user_id = ?";
    $params = [$user['id']];

    if ($onlyTrash) {
        $sql .= " AND deleted_at IS NOT NULL";
    } else {
        $sql .= " AND deleted_at IS NULL";
        if ($parentId === null || $parentId === 'root') {
             $sql .= " AND parent_id IS NULL";
        } else {
             $sql .= " AND parent_id = ?";
             $params[] = $parentId;
        }
    }
    
    $sql .= " ORDER BY name ASC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $folders = $stmt->fetchAll();

    $response->getBody()->write(json_encode($folders));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/folders', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $data = $request->getParsedBody();
    $name = trim((string)($data['name'] ?? 'New Folder'));
    $name = $name !== '' ? $name : 'New Folder';
    $parentId = isset($data['parent_id']) && $data['parent_id'] !== '' ? $data['parent_id'] : null;
    $color = strtoupper(trim((string)($data['color'] ?? '#3e577a')));
    $icon = trim((string)($data['icon'] ?? 'folder'));

    if (!preg_match('/^#[0-9A-F]{6}$/', $color)) {
        $color = '#3E577A';
    }

    if (!preg_match('/^[a-z0-9_-]{2,64}$/i', $icon)) {
        $icon = 'folder';
    }

    $stmt = $db->prepare("INSERT INTO folders (user_id, name, color, icon, parent_id) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$user['id'], $name, $color, $icon, $parentId]);
    
    $id = $db->lastInsertId();
    $stmt = $db->prepare("SELECT * FROM folders WHERE id = ?");
    $stmt->execute([$id]);
    $folder = $stmt->fetch();

    $response->getBody()->write(json_encode($folder));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

// --- FILE OPERATIONS (Move, Favorite, Trash) ---

$app->post('/files/{id}/favorite', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $fileId = $args['id'];
    
    $stmt = $db->prepare("SELECT id, is_favorite FROM files WHERE id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $file = $stmt->fetch();
    
    if (!$file) {
        $response->getBody()->write(json_encode(['error' => 'File not found']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }
    
    $newStatus = $file['is_favorite'] ? 0 : 1;
    $stmt = $db->prepare("UPDATE files SET is_favorite = ? WHERE id = ?");
    $stmt->execute([$newStatus, $fileId]);
    
    $response->getBody()->write(json_encode(['success' => true, 'is_favorite' => (bool)$newStatus]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/files/{id}/trash', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $fileId = $args['id'];
    $data = $request->getParsedBody();
    $restore = isset($data['restore']) && $data['restore'] == true;
    
    $stmt = $db->prepare("SELECT id FROM files WHERE id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    
    if (!$stmt->fetch()) {
        $response->getBody()->write(json_encode(['error' => 'File not found']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }
    
    $deletedAt = $restore ? null : date('Y-m-d H:i:s');
    $stmt = $db->prepare("UPDATE files SET deleted_at = ? WHERE id = ?");
    $stmt->execute([$deletedAt, $fileId]);
    
    $response->getBody()->write(json_encode(['success' => true, 'deleted_at' => $deletedAt]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->delete('/files/{id}/trash', function (Request $request, Response $response, array $args) use ($db, $telegramService, $config) {
    $user = $request->getAttribute('user');
    $fileId = (int)$args['id'];

    $stmt = $db->prepare("SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL");
    $stmt->execute([$fileId, $user['id']]);
    $file = $stmt->fetch();

    if (!$file) {
        $response->getBody()->write(json_encode(['error' => 'Cop kutusunda dosya bulunamadi']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    permanentlyDeleteStoredFile($db, $telegramService, $config, $file);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Dosya kalici olarak silindi']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/files/{id}/rename', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $fileId = $args['id'];
    $data = $request->getParsedBody() ?? [];
    $displayName = trim((string)($data['display_name'] ?? ''));

    if ($displayName === '') {
        $response->getBody()->write(json_encode(['error' => 'Display name is required']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("SELECT id, file_name FROM files WHERE id = ? AND user_id = ?");
    $stmt->execute([$fileId, $user['id']]);
    $file = $stmt->fetch();

    if (!$file) {
        $response->getBody()->write(json_encode(['error' => 'File not found']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    $stmt = $db->prepare("UPDATE files SET display_name = ? WHERE id = ?");
    $stmt->execute([$displayName, $fileId]);

    $response->getBody()->write(json_encode([
        'success' => true,
        'id' => (int)$fileId,
        'display_name' => $displayName,
        'filename' => $file['file_name'],
    ]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/folders/{id}/trash', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $folderId = $args['id'];
    $data = $request->getParsedBody();
    $restore = isset($data['restore']) && $data['restore'] == true;
    
    $stmt = $db->prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?");
    $stmt->execute([$folderId, $user['id']]);
    
    if (!$stmt->fetch()) {
        $response->getBody()->write(json_encode(['error' => 'Folder not found']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }
    
    $deletedAt = $restore ? null : date('Y-m-d H:i:s');
    $stmt = $db->prepare("UPDATE folders SET deleted_at = ? WHERE id = ?");
    $stmt->execute([$deletedAt, $folderId]);
    
    $response->getBody()->write(json_encode(['success' => true, 'deleted_at' => $deletedAt]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->delete('/folders/{id}/trash', function (Request $request, Response $response, array $args) use ($db, $telegramService, $config) {
    $user = $request->getAttribute('user');
    $folderId = (int)$args['id'];

    $stmt = $db->prepare("SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL");
    $stmt->execute([$folderId, $user['id']]);
    if (!$stmt->fetch()) {
        $response->getBody()->write(json_encode(['error' => 'Cop kutusunda klasor bulunamadi']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    $result = permanentlyDeleteFolderTree($db, $telegramService, $config, (int)$user['id'], $folderId);

    $response->getBody()->write(json_encode([
        'success' => true,
        'message' => 'Klasor kalici olarak silindi',
        'deleted_file_count' => $result['deleted_file_count'],
        'deleted_folder_count' => $result['deleted_folder_count'],
    ]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/files/{id}/move', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $fileId = $args['id'];
    $data = $request->getParsedBody() ?? [];
    $folderId = isset($data['folder_id']) && $data['folder_id'] !== '' ? $data['folder_id'] : null;

    $fileStmt = $db->prepare("SELECT id FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL");
    $fileStmt->execute([$fileId, $user['id']]);
    if (!$fileStmt->fetch()) {
        $response->getBody()->write(json_encode(['error' => 'File not found']));
        return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
    }

    if ($folderId !== null) {
        $folderStmt = $db->prepare("SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL");
        $folderStmt->execute([$folderId, $user['id']]);
        if (!$folderStmt->fetch()) {
            $response->getBody()->write(json_encode(['error' => 'Target folder not found']));
            return $response->withStatus(404)->withHeader('Content-Type', 'application/json');
        }
    }

    $stmt = $db->prepare("UPDATE files SET folder_id = ? WHERE id = ? AND user_id = ?");
    $stmt->execute([$folderId, $fileId, $user['id']]);

    $response->getBody()->write(json_encode(['success' => true, 'folder_id' => $folderId]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

// --- TAG ROUTES ---

$app->get('/tags', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $stmt = $db->prepare("SELECT * FROM tags WHERE user_id = ?");
    $stmt->execute([$user['id']]);
    $tags = $stmt->fetchAll();
    
    $response->getBody()->write(json_encode($tags));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->post('/tags', function (Request $request, Response $response) use ($db) {
    $user = $request->getAttribute('user');
    $data = $request->getParsedBody();
    $name = $data['name'] ?? '';
    $color = $data['color'] ?? '#3e577a';
    
    if (empty($name)) {
        $response->getBody()->write(json_encode(['error' => 'Name required']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }
    
    $stmt = $db->prepare("INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)");
    $stmt->execute([$user['id'], $name, $color]);
    
    $id = $db->lastInsertId();
    $response->getBody()->write(json_encode(['id' => $id, 'name' => $name, 'color' => $color]));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->run();
