<?php
/**
 * GoogleDriveStorage - Helper class for Google Drive API integration
 * Uses Service Account authentication (JWT)
 * 
 * Requires: PHP 8.0+, cURL extension
 * 
 * @see MANIFEST.md - External Development Workflow
 */

class GoogleDriveStorage {
    private $accessToken = '';
    private $tokenExpires = 0;
    private $credentials;
    private $folderId;
    
    /**
     * @param string $credentialsJson - JSON string of Service Account credentials
     * @param string $folderId - Target Google Drive Folder ID
     */
    public function __construct($credentialsJson, $folderId) {
        $this->credentials = json_decode($credentialsJson, true);
        if (!$this->credentials || !isset($this->credentials['private_key'])) {
            throw new Exception('Invalid Service Account credentials JSON');
        }
        $this->folderId = $folderId;
    }
    
    /**
     * Get or refresh OAuth2 Access Token using JWT assertion
     */
    private function getAccessToken() {
        // Return cached token if still valid
        if ($this->accessToken && time() < $this->tokenExpires - 60) {
            return $this->accessToken;
        }
        
        $now = time();
        $exp = $now + 3600; // 1 hour
        
        // Build JWT Header
        $header = [
            'alg' => 'RS256',
            'typ' => 'JWT'
        ];
        
        // Build JWT Claim Set
        $claim = [
            'iss' => $this->credentials['client_email'],
            'scope' => 'https://www.googleapis.com/auth/drive.file',
            'aud' => 'https://oauth2.googleapis.com/token',
            'iat' => $now,
            'exp' => $exp
        ];
        
        // Encode to Base64URL
        $headerB64 = $this->base64UrlEncode(json_encode($header));
        $claimB64 = $this->base64UrlEncode(json_encode($claim));
        
        // Create signature
        $signatureInput = $headerB64 . '.' . $claimB64;
        $privateKey = openssl_pkey_get_private($this->credentials['private_key']);
        if (!$privateKey) {
            throw new Exception('Invalid private key in credentials');
        }
        
        openssl_sign($signatureInput, $signature, $privateKey, OPENSSL_ALGO_SHA256);
        $signatureB64 = $this->base64UrlEncode($signature);
        
        $jwt = $signatureInput . '.' . $signatureB64;
        
        // Exchange JWT for Access Token
        $ch = curl_init('https://oauth2.googleapis.com/token');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query([
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $jwt
            ]),
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded']
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode !== 200) {
            throw new Exception('Failed to get access token: ' . $response);
        }
        
        $data = json_decode($response, true);
        $this->accessToken = $data['access_token'];
        $this->tokenExpires = $now + ($data['expires_in'] ?? 3600);
        
        return $this->accessToken;
    }
    
    /**
     * Upload a file to Google Drive
     * 
     * @param string $filePath - Local file path or file content
     * @param string $fileName - Target file name in Drive
     * @param string $mimeType - MIME type of the file
     * @param bool $isContent - If true, $filePath is treated as file content, not a path
     * @return array - ['success' => bool, 'fileId' => string, 'webViewLink' => string]
     */
    public function uploadFile($filePath, $fileName, $mimeType, $isContent = false) {
        $token = $this->getAccessToken();
        
        // Get file content
        if ($isContent) {
            $fileContent = $filePath;
        } else {
            if (!file_exists($filePath)) {
                throw new Exception("File not found: $filePath");
            }
            $fileContent = file_get_contents($filePath);
        }
        
        // Prepare metadata
        $metadata = [
            'name' => $fileName,
            'parents' => [$this->folderId]
        ];
        
        // Build multipart request
        $boundary = 'shanon_upload_' . uniqid();
        $body = "--{$boundary}\r\n";
        $body .= "Content-Type: application/json; charset=UTF-8\r\n\r\n";
        $body .= json_encode($metadata) . "\r\n";
        $body .= "--{$boundary}\r\n";
        $body .= "Content-Type: {$mimeType}\r\n";
        $body .= "Content-Transfer-Encoding: base64\r\n\r\n";
        $body .= base64_encode($fileContent) . "\r\n";
        $body .= "--{$boundary}--";
        
        $ch = curl_init('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => [
                "Authorization: Bearer {$token}",
                "Content-Type: multipart/related; boundary={$boundary}",
                "Content-Length: " . strlen($body)
            ]
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode !== 200) {
            error_log("Google Drive upload failed: " . $response);
            return ['success' => false, 'error' => $response];
        }
        
        $data = json_decode($response, true);
        return [
            'success' => true,
            'fileId' => $data['id'] ?? null,
            'webViewLink' => $data['webViewLink'] ?? null
        ];
    }
    
    /**
     * Download file content from Google Drive
     * 
     * @param string $fileId - Google Drive File ID
     * @return string|false - File content or false on error
     */
    public function downloadFile($fileId) {
        $token = $this->getAccessToken();
        
        $ch = curl_init("https://www.googleapis.com/drive/v3/files/{$fileId}?alt=media");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        return $httpCode === 200 ? $response : false;
    }
    
    /**
     * Delete a file from Google Drive
     * 
     * @param string $fileId - Google Drive File ID
     * @return bool
     */
    public function deleteFile($fileId) {
        $token = $this->getAccessToken();
        
        $ch = curl_init("https://www.googleapis.com/drive/v3/files/{$fileId}");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => 'DELETE',
            CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
        ]);
        
        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        return $httpCode === 204 || $httpCode === 200;
    }
    
    /**
     * List files in the configured folder
     * 
     * @param int $maxResults
     * @return array
     */
    public function listFiles($maxResults = 100) {
        $token = $this->getAccessToken();
        
        $query = urlencode("'{$this->folderId}' in parents and trashed = false");
        $url = "https://www.googleapis.com/drive/v3/files?q={$query}&pageSize={$maxResults}&fields=files(id,name,mimeType,size,createdTime)";
        
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode !== 200) {
            return ['success' => false, 'error' => $response];
        }
        
        $data = json_decode($response, true);
        return ['success' => true, 'files' => $data['files'] ?? []];
    }
    
    /**
     * Test connection to Google Drive
     * 
     * @return array - ['success' => bool, 'folderName' => string]
     */
    public function testConnection() {
        try {
            $token = $this->getAccessToken();
            
            // Try to get folder metadata
            $ch = curl_init("https://www.googleapis.com/drive/v3/files/{$this->folderId}?fields=id,name");
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"]
            ]);
            
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            
            if ($httpCode !== 200) {
                return ['success' => false, 'error' => 'Cannot access folder: ' . $response];
            }
            
            $data = json_decode($response, true);
            return [
                'success' => true,
                'folderId' => $data['id'],
                'folderName' => $data['name']
            ];
        } catch (Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Base64 URL-safe encoding
     */
    private function base64UrlEncode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
