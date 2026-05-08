<?php

namespace App\Services;

use Resend;

class ResendService
{
    private $resend;

    public function __construct(string $apiKey)
    {
        $this->resend = Resend::client($apiKey);
    }

    /**
     * Dosya yüklendikten sonra paylaşım linkini e-posta ile gönderir.
     */
    public function sendShareLinkEmail(
        string $toEmail,
        string $shareUrl,
        string $fileName,
        string $fileSize,
        string $expiresAt
    ): array {
        try {
            $result = $this->resend->emails->send([
                'from' => 'Telegram Drive <onboarding@resend.dev>',
                'to' => $toEmail,
                'subject' => '📁 Dosya Paylaşım Linkin Hazır - ' . $fileName,
                'html' => $this->buildEmailHtml($shareUrl, $fileName, $fileSize, $expiresAt),
            ]);

            return [
                'success' => true,
                'id' => $result->id ?? null,
            ];
        } catch (\Exception $e) {
            error_log('Resend email error: ' . $e->getMessage());
            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function buildEmailHtml(
        string $shareUrl,
        string $fileName,
        string $fileSize,
        string $expiresAt
    ): string {
        $escapedFileName = htmlspecialchars($fileName, ENT_QUOTES, 'UTF-8');
        $escapedFileSize = htmlspecialchars($fileSize, ENT_QUOTES, 'UTF-8');
        $escapedExpiresAt = htmlspecialchars($expiresAt, ENT_QUOTES, 'UTF-8');
        $escapedShareUrl = htmlspecialchars($shareUrl, ENT_QUOTES, 'UTF-8');

        return <<<HTML
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#0f172a; font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a; padding:40px 20px;">
        <tr>
            <td align="center">
                <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%); border-radius:16px; border:1px solid rgba(99,102,241,0.3); overflow:hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="padding:32px 32px 24px; text-align:center; border-bottom:1px solid rgba(99,102,241,0.15);">
                            <div style="font-size:28px; margin-bottom:8px;">💠</div>
                            <h1 style="margin:0; color:#e2e8f0; font-size:22px; font-weight:600;">Telegram Drive</h1>
                            <p style="margin:6px 0 0; color:#94a3b8; font-size:13px;">Dosya Paylaşım Bildirimi</p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding:28px 32px;">
                            <p style="color:#cbd5e1; font-size:15px; line-height:1.6; margin:0 0 20px;">
                                Merhaba,<br>
                                Bir dosya sizinle paylaşıldı. Aşağıdaki butona tıklayarak dosyayı indirebilirsiniz.
                            </p>

                            <!-- File Info Card -->
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:12px; margin-bottom:24px;">
                                <tr>
                                    <td style="padding:18px 20px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td style="color:#94a3b8; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; padding-bottom:4px;">Dosya Adı</td>
                                            </tr>
                                            <tr>
                                                <td style="color:#e2e8f0; font-size:15px; font-weight:600; padding-bottom:12px;">{$escapedFileName}</td>
                                            </tr>
                                            <tr>
                                                <td>
                                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td style="padding-right:24px;">
                                                                <span style="color:#94a3b8; font-size:12px;">Boyut</span><br>
                                                                <span style="color:#a5b4fc; font-size:14px; font-weight:500;">{$escapedFileSize}</span>
                                                            </td>
                                                            <td>
                                                                <span style="color:#94a3b8; font-size:12px;">Son Geçerlilik</span><br>
                                                                <span style="color:#fbbf24; font-size:14px; font-weight:500;">{$escapedExpiresAt}</span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- CTA Button -->
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <a href="{$escapedShareUrl}" target="_blank" rel="noopener"
                                           style="display:inline-block; background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%); color:#ffffff; text-decoration:none; padding:14px 36px; border-radius:10px; font-size:15px; font-weight:600; letter-spacing:0.3px;">
                                            📥 Dosyayı İndir
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Direct Link -->
                            <p style="margin:20px 0 0; text-align:center;">
                                <span style="color:#64748b; font-size:12px;">veya bu linki tarayıcınıza yapıştırın:</span><br>
                                <a href="{$escapedShareUrl}" style="color:#818cf8; font-size:12px; word-break:break-all;">{$escapedShareUrl}</a>
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding:20px 32px; text-align:center; border-top:1px solid rgba(99,102,241,0.15);">
                            <p style="margin:0; color:#475569; font-size:11px; line-height:1.5;">
                                Bu e-posta Telegram Drive dosya paylaşım sistemi tarafından gönderilmiştir.<br>
                                Link süresi dolduktan sonra dosya otomatik olarak silinecektir.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
HTML;
    }
}
