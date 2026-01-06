<?php

class GoogleDriveStorage {
    private $credentials;
    private $folderId;
    private $accessToken = null;
    private $tokenExpiresAt = 0;

    public function __construct($credentialsJson, $folderId) {
        $data = json_decode($credentialsJson, true);
        
        // Validate specifically for Service Account OR User OAuth
        $isServiceAccount = isset($data['private_key']) && isset($data['client_email']);
        $isUserOAuth = isset($data['refresh_token']) && isset($data['client_id']);

        if (!$data || (!$isServiceAccount && !$isUserOAuth)) {
            throw new Exception("Neplatný JSON s přihlašovacími údaji. Musí obsahovat buď 'private_key' (Service Account) nebo 'refresh_token' (Osobní účet).");
        }
        $this->credentials = $data;
        $this->folderId = $folderId;
    }

    public function testConnection() {
        try {
            $this->getAccessToken();
            
            // Zkusíme načíst info o složce
            $url = "https://www.googleapis.com/drive/v3/files/" . $this->folderId . "?fields=id,name&supportsAllDrives=true";
            $response = $this->makeRequest($url, 'GET');
            
            if (isset($response['error'])) {
                return ['success' => false, 'error' => 'API Error: ' . json_encode($response['error'])];
            }
            
            return ['success' => true, 'folderName' => $response['name'] ?? 'Unknown'];
        } catch (Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    public function listDirectory() {
        $url = "https://www.googleapis.com/drive/v3/files?q='" . $this->folderId . "'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,webViewLink)&includeItemsFromAllDrives=true&supportsAllDrives=true";
        $res = $this->makeRequest($url);
        return $res['files'] ?? [];
    }

    public function uploadFile($localPath, $remoteName, $mimeType) {
        // Simple Multipart Upload
        $metadata = [
            'name' => $remoteName,
            'parents' => [$this->folderId]
        ];
        
        $boundary = '-------' . md5(time());
        $content = file_get_contents($localPath);
        
        $body = "--$boundary\r\n" .
                "Content-Type: application/json; charset=UTF-8\r\n\r\n" .
                json_encode($metadata) . "\r\n" .
                "--$boundary\r\n" .
                "Content-Type: $mimeType\r\n\r\n" .
                $content . "\r\n" .
                "--$boundary--";

        $url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
        
        return $this->makeRequest($url, 'POST', $body, [
            'Content-Type: multipart/related; boundary=' . $boundary,
            'Content-Length: ' . strlen($body)
        ]);
    }

    public function deleteFile($fileId) {
        $url = "https://www.googleapis.com/drive/v3/files/" . $fileId . "?supportsAllDrives=true";
        return $this->makeRequest($url, 'DELETE');
    }

    public function downloadFile($fileId) {
        $url = "https://www.googleapis.com/drive/v3/files/" . $fileId . "?alt=media&supportsAllDrives=true";
        $token = $this->getAccessToken();
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $token]);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        
        $data = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($code >= 400) {
            $this->handleCurlError($code, $data);
        }
        
        return $data;
    }

    private function getAccessToken() {
        if ($this->accessToken && time() < $this->tokenExpiresAt) {
            return $this->accessToken;
        }

        // Support for OAuth 2.0 Refresh Token (Personal Mode)
        if (isset($this->credentials['refresh_token']) && isset($this->credentials['client_id'])) {
             $ch = curl_init();
             curl_setopt($ch, CURLOPT_URL, 'https://oauth2.googleapis.com/token');
             curl_setopt($ch, CURLOPT_POST, 1);
             curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
                 'client_id' => $this->credentials['client_id'],
                 'client_secret' => $this->credentials['client_secret'],
                 'refresh_token' => $this->credentials['refresh_token'],
                 'grant_type' => 'refresh_token'
             ]));
             curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
             $result = curl_exec($ch);
             if (curl_errno($ch)) throw new Exception('Curl Auth Error: ' . curl_error($ch));
             curl_close($ch);
             
             $data = json_decode($result, true);
             if (isset($data['error'])) throw new Exception('Google OAuth Error: ' . ($data['error_description'] ?? $data['error']));

             $this->accessToken = $data['access_token'];
             $this->tokenExpiresAt = time() + ($data['expires_in'] - 30);
             return $this->accessToken;
        }

        // Default: Service Account JWT Flow
        $header = json_encode(['alg' => 'RS256', 'typ' => 'JWT']);
        $now = time();
        $payload = json_encode([
            'iss' => $this->credentials['client_email'],
            'sub' => $this->credentials['client_email'],
            'aud' => 'https://oauth2.googleapis.com/token',
            'iat' => $now,
            'exp' => $now + 3600,
            'scope' => 'https://www.googleapis.com/auth/drive'
        ]);

        $base64Header = $this->base64UrlEncode($header);
        $base64Payload = $this->base64UrlEncode($payload);
        $signatureInput = $base64Header . "." . $base64Payload;

        $signature = '';
        if (!openssl_sign($signatureInput, $signature, $this->credentials['private_key'], 'SHA256')) {
            throw new Exception("Chyba při podepisování JWT tokenu (OpenSSL)");
        }

        $jwt = $signatureInput . "." . $this->base64UrlEncode($signature);

        // Exchange for Access Token
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, 'https://oauth2.googleapis.com/token');
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $jwt
        ]));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        
        $result = curl_exec($ch);
        if (curl_errno($ch)) {
            throw new Exception('Curl error: ' . curl_error($ch));
        }
        curl_close($ch);

        $data = json_decode($result, true);
        if (isset($data['error'])) {
            throw new Exception('Google Auth Error: ' . ($data['error_description'] ?? $data['error']));
        }

        $this->accessToken = $data['access_token'];
        $this->tokenExpiresAt = time() + ($data['expires_in'] - 30);
        
        return $this->accessToken;
    }

    private function base64UrlEncode($data) {
        return str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($data));
    }

    private function handleCurlError($code, $responseBody) {
        $json = json_decode($responseBody, true);
        $msg = $json['error']['message'] ?? $responseBody;

        if ($code === 403) {
            if (strpos($msg, 'Service Accounts do not have storage quota') !== false) {
                 throw new Exception("Google Disk Error (403): Servisní účet nemá kvótu pro nahrávání souborů do Osobních disků. Vlastníkem nahraného souboru by byl robot (0 MB limit). ŘEŠENÍ: Použijte Sdílený disk (Shared Drive), kde je vlastníkem organizace, nebo použijte OAuth 2.0 (Refresh Token).");
            }
            if (strpos($msg, 'The user does not have sufficient permissions') !== false) {
                 throw new Exception("Google Disk Error (403): Nedostatečná oprávnění. Zkontrolujte, zda má e-mail '{$this->credentials['client_email']}' právo Editor v cílové složce.");
            }
        }

        throw new Exception('Google API Error (' . $code . '): ' . $msg);
    }

    private function makeRequest($url, $method = 'GET', $body = null, $extraHeaders = []) {
        $token = $this->getAccessToken();
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        
        $headers = array_merge([
            'Authorization: Bearer ' . $token
        ], $extraHeaders);
        
        if ($body) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
            if (!isset($extraHeaders['Content-Type'])) {
                $headers[] = 'Content-Type: application/json';
            }
        }
        
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        
        $result = curl_exec($ch);
        if (curl_errno($ch)) {
            throw new Exception('API Request Error: ' . curl_error($ch));
        }
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($code >= 400) {
             $this->handleCurlError($code, $result);
        }

        return json_decode($result, true);
    }
}
