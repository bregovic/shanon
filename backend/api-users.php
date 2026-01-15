<?php
// backend/api-users.php - Users Administration CRUD
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

// Auth check
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// Admin check (skip for specific actions)
$userRole = strtolower($_SESSION['user']['role'] ?? '');
$action = $_GET['action'] ?? $_POST['action'] ?? 'list';

$publicActions = ['update_profile'];

if (!in_array($action, $publicActions)) {
    if (!in_array($userRole, ['admin', 'superadmin'])) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Admin access required']);
        exit;
    }
}

try {
    $pdo = DB::connect();
    
    switch ($action) {
        case 'list':
            $stmt = $pdo->query("
                SELECT 
                    rec_id,
                    tenant_id,
                    email,
                    full_name,
                    role,
                    is_active,
                    created_at,
                    updated_at
                FROM sys_users 
                WHERE tenant_id = :tid
                ORDER BY rec_id
            ");
            $stmt->execute([':tid' => $_SESSION['user']['tenant_id']]);
            $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            echo json_encode(['success' => true, 'data' => $users]);
            break;
            
        case 'get':
            $id = $_GET['id'] ?? null;
            if (!$id) throw new Exception("ID required");
            
            $stmt = $pdo->prepare("SELECT * FROM sys_users WHERE rec_id = :id");
            $stmt->execute([':id' => $id]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if (!$user) throw new Exception("User not found");
            
            // Don't return password hash
            unset($user['password_hash']);
            
            echo json_encode(['success' => true, 'data' => $user]);
            break;
            
        case 'create':
            $input = json_decode(file_get_contents('php://input'), true);
            
            $email = trim($input['email'] ?? '');
            $fullName = trim($input['full_name'] ?? '');
            $role = trim($input['role'] ?? 'user');
            $password = $input['password'] ?? '';
            // Fix: Strict Tenant Isolation
            $tenantId = $_SESSION['user']['tenant_id'] ?? null;
            if (!$tenantId) throw new Exception("Session Tenant ID is lost. Please relogin.");
            
            if (empty($email)) throw new Exception("Email is required");
            if (empty($fullName)) throw new Exception("Full name is required");
            if (empty($password)) throw new Exception("Password is required");
            
            // Check email uniqueness within tenant (or globally if strict)
            // Ideally email should be unique globally for login, but let's check global.
            $stmt = $pdo->prepare("SELECT 1 FROM sys_users WHERE email = :email");
            $stmt->execute([':email' => $email]);
            if ($stmt->fetch()) throw new Exception("Email already exists in the system");
            
            // Hash password
            $passwordHash = password_hash($password, PASSWORD_DEFAULT);
            
            // Generate initials
            $nameParts = explode(' ', $fullName);
            $initials = '';
            foreach ($nameParts as $part) {
                if (!empty($part)) $initials .= strtoupper(substr($part, 0, 1));
            }
            $initials = substr($initials, 0, 2);
            
            $stmt = $pdo->prepare("
                INSERT INTO sys_users (tenant_id, email, password_hash, full_name, role, initials, is_active)
                VALUES (:tid, :email, :pwd, :name, :role, :initials, true)
                RETURNING rec_id
            ");
            $stmt->execute([
                ':tid' => $tenantId,
                ':email' => $email,
                ':pwd' => $passwordHash,
                ':name' => $fullName,
                ':role' => $role,
                ':initials' => $initials
            ]);
            $newId = $stmt->fetchColumn();
            
            echo json_encode(['success' => true, 'message' => 'User created', 'rec_id' => $newId]);
            break;
            
        case 'update':
            $input = json_decode(file_get_contents('php://input'), true);
            $id = $input['rec_id'] ?? null;
            
            if (!$id) throw new Exception("ID required");
            
            $sets = [];
            $params = [':id' => $id];
            
            if (isset($input['email'])) {
                $sets[] = "email = :email";
                $params[':email'] = trim($input['email']);
            }
            if (isset($input['full_name'])) {
                $sets[] = "full_name = :name";
                $params[':name'] = trim($input['full_name']);
                
                // Update initials
                $nameParts = explode(' ', trim($input['full_name']));
                $initials = '';
                foreach ($nameParts as $part) {
                    if (!empty($part)) $initials .= strtoupper(substr($part, 0, 1));
                }
                $sets[] = "initials = :initials";
                $params[':initials'] = substr($initials, 0, 2);
            }
            if (isset($input['role'])) {
                $sets[] = "role = :role";
                $params[':role'] = trim($input['role']);
            }
            if (isset($input['is_active'])) {
                $sets[] = "is_active = :active";
                $params[':active'] = (bool)$input['is_active'];
            }
            if (!empty($input['password'])) {
                $sets[] = "password_hash = :pwd";
                $params[':pwd'] = password_hash($input['password'], PASSWORD_DEFAULT);
            }
            
            if (empty($sets)) throw new Exception("No fields to update");
            
            $sets[] = "updated_at = NOW()";
            
            $sql = "UPDATE sys_users SET " . implode(', ', $sets) . " WHERE rec_id = :id";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            
            echo json_encode(['success' => true, 'message' => 'User updated']);
            break;
            
        case 'delete':
            $input = json_decode(file_get_contents('php://input'), true);
            $ids = $input['ids'] ?? [];
            
            if (empty($ids)) throw new Exception("No IDs provided");
            
            // Prevent deleting own account
            $currentUserId = $_SESSION['user']['id'] ?? $_SESSION['user']['rec_id'] ?? 0;
            if (in_array($currentUserId, $ids)) {
                throw new Exception("Cannot delete your own account");
            }
            
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("DELETE FROM sys_users WHERE rec_id IN ($placeholders)");
            $stmt->execute($ids);
            
            echo json_encode(['success' => true, 'message' => 'Users deleted', 'count' => $stmt->rowCount()]);
            break;
            
        case 'update_profile':
            $input = json_decode(file_get_contents('php://input'), true);
            $userId = $_SESSION['user']['id'] ?? $_SESSION['user']['rec_id'] ?? null;
            
            if (!$userId) throw new Exception("User ID missing in session");

            $newPassword = $input['password'] ?? '';
            
            if (empty($newPassword)) throw new Exception("Heslo je povinné");
            
            $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
            
            $stmt = $pdo->prepare("UPDATE sys_users SET password_hash = :pwd, updated_at = NOW() WHERE rec_id = :id");
            $stmt->execute([':pwd' => $passwordHash, ':id' => $userId]);
            
            echo json_encode(['success' => true, 'message' => 'Heslo změněno']);
            break;

        default:
            throw new Exception("Unknown action: $action");
    }
    
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
