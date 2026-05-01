<?php

namespace App\Services;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use DateTimeImmutable;

class AuthService
{
    private string $secretKey;
    private string $algorithm = 'HS256';

    public function __construct(string $secretKey)
    {
        $this->secretKey = $secretKey;
    }

    public function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_BCRYPT);
    }

    public function verifyPassword(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public function createToken(string $email, int $expireMinutes = 30): string
    {
        $issuedAt = new DateTimeImmutable();
        $expire = $issuedAt->modify("+{$expireMinutes} minutes")->getTimestamp();

        $data = [
            'iat'  => $issuedAt->getTimestamp(),
            'nbf'  => $issuedAt->getTimestamp(),
            'exp'  => $expire,
            'sub' => $email,
        ];

        return JWT::encode($data, $this->secretKey, $this->algorithm);
    }

    public function decodeToken(string $token)
    {
        try {
            return (array) JWT::decode($token, new Key($this->secretKey, $this->algorithm));
        } catch (\Exception $e) {
            return null;
        }
    }
}
