<?php

namespace App\Services;

use GuzzleHttp\Client;

class TelegramService
{
    private array $botTokens;
    private array $clients = [];
    
    public function __construct(array $botTokens)
    {
        $this->botTokens = $botTokens;
        foreach ($botTokens as $token) {
            $this->clients[] = [
                'token' => $token,
                'client' => new Client(['base_uri' => "https://api.telegram.org/bot{$token}/"])
            ];
        }
    }

    private function getRandomBot()
    {
        return $this->clients[array_rand($this->clients)];
    }

    private function getClientByToken(string $token): Client
    {
        foreach ($this->clients as $bot) {
            if ($bot['token'] === $token) {
                return $bot['client'];
            }
        }
        // Fallback to first bot if token not found
        return $this->clients[0]['client'];
    }

    public function sendDocument(string $chatId, $fileBuffer, string $filename, string $caption = '', ?string $token = null)
    {
        $bot = $token ? ['token' => $token, 'client' => $this->getClientByToken($token)] : $this->getRandomBot();
        
        try {
            $response = $bot['client']->post('sendDocument', [
                'multipart' => [
                    [
                        'name'     => 'chat_id',
                        'contents' => $chatId
                    ],
                    [
                        'name'     => 'document',
                        'contents' => $fileBuffer,
                        'filename' => $filename
                    ],
                    [
                        'name'     => 'caption',
                        'contents' => $caption
                    ]
                ]
            ]);

            $result = json_decode($response->getBody()->getContents(), true);
            if (isset($result['ok']) && $result['ok']) {
                $result['used_token'] = $bot['token'];
            }
            return $result;
        } catch (\Exception $e) {
            error_log("Guzzle Error: " . $e->getMessage());
            throw $e;
        }
    }

    public function getFile(string $fileId, ?string $token = null)
    {
        $client = $token ? $this->getClientByToken($token) : $this->getRandomBot()['client'];
        $response = $client->get('getFile', [
            'query' => ['file_id' => $fileId]
        ]);

        return json_decode($response->getBody()->getContents(), true);
    }

    public function getFileUrl(string $filePath, ?string $token = null): string
    {
        $usedToken = $token ?: $this->getRandomBot()['token'];
        return "https://api.telegram.org/file/bot{$usedToken}/{$filePath}";
    }

    public function deleteMessage(string $chatId, int $messageId, ?string $token = null)
    {
        try {
            if ($token) {
                 $client = new Client(['base_uri' => "https://api.telegram.org/bot{$token}/"]);
                 $response = $client->post('deleteMessage', [
                    'json' => [
                        'chat_id' => $chatId,
                        'message_id' => $messageId
                    ]
                 ]);
                 return json_decode($response->getBody()->getContents(), true);
            }

            $bot = $this->getRandomBot();
            $response = $bot['client']->post('deleteMessage', [
                'json' => [
                    'chat_id' => $chatId,
                    'message_id' => $messageId
                ]
            ]);
            return json_decode($response->getBody()->getContents(), true);
        } catch (\Exception $e) {
            return ['ok' => false, 'description' => $e->getMessage()];
        }
    }
}
