<?php
// backend/api-favorites.php

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header('Content-Type: application/json');

if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$userId = $_SESSION['user']['id'] ?? $_SESSION['user_id'] ?? 0;
// We ignore Tenant for favorites as they are user-specific, but path might include org prefix.
// The frontend handles path generation.

$action = $_GET['action'] ?? 'list';
$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = DB::connect();

    if ($method === 'GET') {
        // List favorites
        $stmt = $pdo->prepare("SELECT * FROM sys_user_favorites WHERE user_id = ? ORDER BY title ASC");
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $rows]);
        
    } elseif ($method === 'POST') {
        // Add favorite
        $input = json_decode(file_get_contents('php://input'), true);
        $path = $input['path'] ?? '';
        $title = $input['title'] ?? '';
        $module = $input['module'] ?? '';

        if (!$path || !$title) {
            throw new Exception("Missing path or title");
        }

        $stmt = $pdo->prepare("
            INSERT INTO sys_user_favorites (user_id, path, title, module)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id, path) DO UPDATE SET title = EXCLUDED.title, module = EXCLUDED.module
        ");
        $stmt->execute([$userId, $path, $title, $module]);
        
        echo json_encode(['success' => true]);

    } elseif ($method === 'DELETE') {
        // Remove favorite
        $path = $_GET['path'] ?? '';
        if (!$path) {
            // Support body delete too if preferred
            $input = json_decode(file_get_contents('php://input'), true);
            $path = $input['path'] ?? '';
        }

        if (!$path) {
             throw new Exception("Missing path");
        }

        $stmt = $pdo->prepare("DELETE FROM sys_user_favorites WHERE user_id = ? AND path = ?");
        $stmt->execute([$userId, $path]);
        
        echo json_encode(['success' => true]);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
