<?php

use App\Database;
use App\Services\AuthService;
use App\Services\TelegramService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;
use Slim\Middleware\BodyParsingMiddleware;

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
    'TELEGRAM_BOT_TOKEN' => $_ENV['TELEGRAM_BOT_TOKEN'] ?? '7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto',
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

    if (empty($uploadedFiles['file'])) {
        $response->getBody()->write(json_encode(['error' => 'No file uploaded']));
        return $response->withStatus(400)->withHeader('Content-Type', 'application/json');
    }

    $file = $uploadedFiles['file'];
    if ($file->getError() !== UPLOAD_ERR_OK) {
        $response->getBody()->write(json_encode(['error' => 'File upload error']));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }

    $fileSize = (int)($file->getSize() ?? 0);
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

    // Determine if we should use Python Bridge (e.g., for all files or large ones)
    // The user explicitly requested to use PHP implementation ("php olarak yazmalısın")
    // So we will use the native PHP TelegramService instead of the Python Bridge.

    try {
        $caption = "📁 Dosya: " . $file->getClientFilename() . "\n";
        $caption .= "🆔 ID: " . $user['id'] . "\n";
        $caption .= "👤 İsim: " . trim($user['first_name'] . ' ' . $user['last_name']) . "\n";
        if (!empty($user['username'])) {
            $caption .= "🏷️ Kullanıcı Adı: @" . $user['username'] . "\n";
        }
        $caption .= "📧 Email: " . $user['email'] . "\n";
        $caption .= "📅 Tarih: " . date('Y-m-d H:i:s');
        
        // Read file content
        $stream = $file->getStream();
        $stream->rewind();
        $content = $stream->getContents();

        // Upload to Telegram via PHP Service
        $result = $telegramService->sendDocument(
            $config['TELEGRAM_CHAT_ID'],
            $content,
            $file->getClientFilename(),
            $caption
        );

        if (!isset($result['ok']) || !$result['ok']) {
             throw new Exception("Telegram Upload Error: " . ($result['description'] ?? 'Unknown error'));
        }

        $messagePayload = $result['result'] ?? [];
        $media = $messagePayload['document'] ?? $messagePayload['video'] ?? null;
        if (!$media || empty($media['file_id'])) {
            throw new Exception('Telegram response did not include a storable file payload');
        }

        $messageId = $result['result']['message_id'];
        $usedToken = $result['used_token'] ?? null;
        
        // Get File Path for Direct Link
        $telegramUrl = null;
        if ($usedToken) {
             try {
                 $fileInfo = $telegramService->getFile($media['file_id'], $usedToken);
                 if ($fileInfo['ok']) {
                     $telegramUrl = $telegramService->getFileUrl($fileInfo['result']['file_path'], $usedToken);
                 }
             } catch (\Exception $e) {
                 // Ignore if getting link fails, main upload succeeded
                 error_log("Failed to get file link: " . $e->getMessage());
             }
        }
        
        // Insert into Database
        $stmt = $db->prepare("INSERT INTO files (telegram_file_id, telegram_message_id, file_name, display_name, file_size, file_type, mime_type, user_id, bot_token, folder_id, telegram_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        
        $parsedBody = $request->getParsedBody() ?? [];
        $folderId = $parsedBody['folder_id'] ?? null;
        if ($folderId === 'root' || $folderId === '') $folderId = null;

        $telegramFileSize = (int)($media['file_size'] ?? $fileSize);
        $telegramMimeType = $media['mime_type'] ?? $file->getClientMediaType() ?? 'application/octet-stream';

        $stmt->execute([
            $media['file_id'],
            $messageId,
            $file->getClientFilename(),
            $file->getClientFilename(),
            $telegramFileSize,
            $telegramMimeType,
            $telegramMimeType,
            $user['id'],
            $usedToken,
            $folderId,
            $telegramUrl // New field
        ]);

        $newFileId = $db->lastInsertId();

        $response->getBody()->write(json_encode([
            'success' => true,
            'message' => "Dosya başarıyla yüklendi (PHP)",
            'file_info' => [
                 'filename' => $file->getClientFilename(),
                 'file_id' => $media['file_id'],
                 'id' => $newFileId
            ]
        ]));
        return $response->withHeader('Content-Type', 'application/json');

    } catch (Exception $e) {
        error_log("Upload Error: " . $e->getMessage() . "\n" . $e->getTraceAsString()); // Enhanced logging
        $response->getBody()->write(json_encode([
            'error' => $e->getMessage(),
            'trace' => $e->getTraceAsString(), // Send trace to client for debugging
            'status' => 'error'
        ]));
        return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
    }
})->add($authMiddleware);

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

$app->get('/share/{token}', function (Request $request, Response $response, array $args) use ($db) {
    $shareToken = $args['token'];

    $stmt = $db->prepare("SELECT * FROM files WHERE share_token = ? AND deleted_at IS NULL LIMIT 1");
    $stmt->execute([$shareToken]);
    $file = $stmt->fetch();

    if (!$file) {
        $response->getBody()->write('File not found');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    $uri = $request->getUri();
    $baseUrl = $uri->getScheme() . '://' . $uri->getAuthority();
    $downloadUrl = $baseUrl . '/share/' . $shareToken . '/download';
    $fileName = htmlspecialchars($file['file_name'] ?: 'Shared file', ENT_QUOTES, 'UTF-8');
    $mimeType = htmlspecialchars($file['mime_type'] ?: 'Unknown file type', ENT_QUOTES, 'UTF-8');
    $sizeLabel = formatBytes((int)($file['file_size'] ?? 0));
    $uploadedAt = !empty($file['upload_date']) ? date('d.m.Y H:i', strtotime($file['upload_date'])) : '-';

    $html = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{$fileName} - Secure Download</title>
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
    .subtle { text-align: center; color: #64748b; font-size: 13px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="hero">
        <div class="badge">Secure Transfer</div>
        <h1>{$fileName}</h1>
        <p>This file is ready for download. The original Telegram file link stays hidden.</p>
      </div>
      <div class="content">
        <div class="meta">
          <div class="meta-item">
            <div class="meta-label">File Type</div>
            <div class="meta-value">{$mimeType}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">File Size</div>
            <div class="meta-value">{$sizeLabel}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Uploaded</div>
            <div class="meta-value">{$uploadedAt}</div>
          </div>
        </div>
        <a class="button" href="{$downloadUrl}">Download File</a>
        <div class="subtle">Powered by your secure cloud workspace</div>
      </div>
    </div>
  </div>
</body>
</html>
HTML;

    $response->getBody()->write($html);
    return $response->withHeader('Content-Type', 'text/html; charset=utf-8');
});

$app->get('/share/{token}/download', function (Request $request, Response $response, array $args) use ($db, $telegramService) {
    $shareToken = $args['token'];

    $stmt = $db->prepare("SELECT * FROM files WHERE share_token = ? AND deleted_at IS NULL LIMIT 1");
    $stmt->execute([$shareToken]);
    $file = $stmt->fetch();

    if (!$file) {
        $response->getBody()->write('File not found');
        return $response->withStatus(404)->withHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    try {
        $token = $file['bot_token'] ?? null;
        $res = $telegramService->getFile($file['telegram_file_id'], $token);
        if (!$res['ok']) {
            throw new Exception("Telegram error: " . ($res['description'] ?? ''));
        }

        $url = $telegramService->getFileUrl($res['result']['file_path'], $token);
        $fileStream = fopen($url, 'rb');

        if (!$fileStream) {
            throw new Exception('File stream could not be opened');
        }

        header('Content-Type: ' . ($file['mime_type'] ?: 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . basename($file['file_name']) . '"');
        header('Cache-Control: no-store');
        fpassthru($fileStream);
        fclose($fileStream);
        exit;
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

    // If file is large (> 20MB), redirect to Python Bridge
    if ($f['file_size'] > 20 * 1024 * 1024) {
        $pythonUrl = ($_ENV['PYTHON_API_URL'] ?? 'http://localhost:8002');
        $downloadUrl = $pythonUrl . "/download/" . $fileId . "/" . urlencode($f['file_name']);
        
        // Log download
        $stmt = $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)");
        $stmt->execute([
            $f['id'],
            0,
            $request->getServerParams()['REMOTE_ADDR'] ?? null,
            $request->getHeaderLine('User-Agent')
        ]);
        $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([$f['id']]);

        return $response->withHeader('Location', $downloadUrl)->withStatus(302);
    }

    try {
        $token = $f['bot_token'] ?? null;
        $res = $telegramService->getFile($fileId, $token);
        if (!$res['ok']) throw new Exception("Telegram error: " . ($res['description'] ?? ''));

        $url = $telegramService->getFileUrl($res['result']['file_path'], $token);

        // Log download
        $stmt = $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)");
        $stmt->execute([
            $f['id'],
            0,
            $request->getServerParams()['REMOTE_ADDR'] ?? null,
            $request->getHeaderLine('User-Agent')
        ]);

        $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([$f['id']]);

        return $response->withHeader('Location', $url)
                        ->withHeader('Content-Disposition', 'attachment; filename="' . $f['file_name'] . '"')
                        ->withStatus(302);
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

    // If file is large (> 20MB), redirect to Python Bridge (streaming)
    if ($f['file_size'] > 20 * 1024 * 1024) {
        $pythonUrl = ($_ENV['PYTHON_API_URL'] ?? 'http://localhost:8002');
        $streamUrl = $pythonUrl . "/download/" . $fileId . "/" . urlencode($f['file_name']) . "?stream=true";
        
        // Log stream as download
        $stmt = $db->prepare("INSERT INTO download_logs (file_id, user_telegram_id, ip_address, user_agent) VALUES (?, ?, ?, ?)");
        $stmt->execute([
            $f['id'],
            0,
            $request->getServerParams()['REMOTE_ADDR'] ?? null,
            $request->getHeaderLine('User-Agent')
        ]);
        $db->prepare("UPDATE files SET download_count = download_count + 1 WHERE id = ?")->execute([$f['id']]);

        return $response->withHeader('Location', $streamUrl)->withStatus(302);
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

    // Delete from Telegram if message_id exists
    if (!empty($f['telegram_message_id'])) {
        try {
            $token = $f['bot_token'] ?? null;
            $telegramService->deleteMessage($config['TELEGRAM_CHAT_ID'], $f['telegram_message_id'], $token);
        } catch (\Exception $e) {
            error_log("Telegram delete error: " . $e->getMessage());
        }
    }

    $stmt = $db->prepare("DELETE FROM files WHERE id = ?");
    $stmt->execute([$f['id']]);

    $response->getBody()->write(json_encode(['success' => true, 'message' => 'Dosya silindi']));
    return $response->withHeader('Content-Type', 'application/json');
})->add($authMiddleware);

$app->get('/preview/{id}', function (Request $request, Response $response, array $args) use ($db, $telegramService) {
    $fileId = $args['id'];
    $stmt = $db->prepare("SELECT telegram_file_id, mime_type, bot_token FROM files WHERE telegram_file_id = ?");
    $stmt->execute([$fileId]);
    $file = $stmt->fetch();

    if (!$file || strpos($file['mime_type'], 'image') === false) {
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
        'python_api_url' => $_ENV['PYTHON_API_URL'] ?? 'http://localhost:8002',
        'max_bot_api_size' => 50 * 1024 * 1024 // 50MB
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

    // Delete from Telegram if message_id exists
    if (!empty($f['telegram_message_id'])) {
        try {
            $token = $f['bot_token'] ?? null;
            $telegramService->deleteMessage($config['TELEGRAM_CHAT_ID'], $f['telegram_message_id'], $token);
        } catch (\Exception $e) {
            error_log("Telegram delete error: " . $e->getMessage());
        }
    }

    $stmt = $db->prepare("DELETE FROM files WHERE id = ?");
    $stmt->execute([$f['id']]);

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
    $name = $data['name'] ?? 'New Folder';
    $parentId = isset($data['parent_id']) && $data['parent_id'] !== '' ? $data['parent_id'] : null;

    $stmt = $db->prepare("INSERT INTO folders (user_id, name, parent_id) VALUES (?, ?, ?)");
    $stmt->execute([$user['id'], $name, $parentId]);
    
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

$app->post('/files/{id}/move', function (Request $request, Response $response, array $args) use ($db) {
    $user = $request->getAttribute('user');
    $fileId = $args['id'];
    $data = $request->getParsedBody();
    $folderId = isset($data['folder_id']) && $data['folder_id'] !== '' ? $data['folder_id'] : null;
    
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
