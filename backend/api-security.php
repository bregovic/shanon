<?php
/**
 * Security & RBAC API
 * Endpoints for managing roles, objects, and permissions
 */
require_once 'db.php';
require_once 'auth.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? '';
$pdo = DB::connect();

try {
    switch ($action) {
        // =====================
        // ROLES
        // =====================
        case 'get_roles':
            $stmt = $pdo->query("SELECT rec_id, code, description, created_at FROM sys_security_roles ORDER BY code");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            break;

        case 'create_role':
            $data = json_decode(file_get_contents('php://input'), true);
            $stmt = $pdo->prepare("INSERT INTO sys_security_roles (code, description) VALUES (?, ?) RETURNING rec_id");
            $stmt->execute([$data['code'], $data['description'] ?? '']);
            $id = $stmt->fetchColumn();
            echo json_encode(['success' => true, 'id' => $id]);
            break;

        case 'delete_role':
            $id = $_GET['id'] ?? 0;
            $stmt = $pdo->prepare("DELETE FROM sys_security_roles WHERE rec_id = ?");
            $stmt->execute([$id]);
            echo json_encode(['success' => true]);
            break;

        // =====================
        // SECURITY OBJECTS
        // =====================
        case 'get_objects':
            $stmt = $pdo->query("SELECT rec_id, identifier, type, display_name, description FROM sys_security_objects ORDER BY type, display_name");
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            break;

        case 'create_object':
            $data = json_decode(file_get_contents('php://input'), true);
            $stmt = $pdo->prepare("INSERT INTO sys_security_objects (identifier, type, display_name, description) VALUES (?, ?, ?, ?) RETURNING rec_id");
            $stmt->execute([$data['identifier'], $data['type'], $data['display_name'], $data['description'] ?? '']);
            $id = $stmt->fetchColumn();
            echo json_encode(['success' => true, 'id' => $id]);
            break;

        case 'delete_object':
            $id = $_GET['id'] ?? 0;
            $stmt = $pdo->prepare("DELETE FROM sys_security_objects WHERE rec_id = ?");
            $stmt->execute([$id]);
            echo json_encode(['success' => true]);
            break;

        // =====================
        // PERMISSIONS (Role <-> Object mapping)
        // =====================
        case 'get_permissions':
            $roleId = $_GET['role_id'] ?? null;
            $sql = "
                SELECT 
                    p.rec_id,
                    p.role_id,
                    r.code as role_code,
                    p.object_id,
                    o.identifier as object_identifier,
                    o.display_name as object_name,
                    o.type as object_type,
                    p.access_level
                FROM sys_security_permissions p
                JOIN sys_security_roles r ON r.rec_id = p.role_id
                JOIN sys_security_objects o ON o.rec_id = p.object_id
            ";
            if ($roleId) {
                $sql .= " WHERE p.role_id = ?";
                $stmt = $pdo->prepare($sql . " ORDER BY o.type, o.display_name");
                $stmt->execute([$roleId]);
            } else {
                $stmt = $pdo->query($sql . " ORDER BY r.code, o.type, o.display_name");
            }
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            break;

        case 'set_permission':
            // Upsert permission for role+object
            $data = json_decode(file_get_contents('php://input'), true);
            $roleId = $data['role_id'];
            $objectId = $data['object_id'];
            $accessLevel = $data['access_level'];

            $stmt = $pdo->prepare("
                INSERT INTO sys_security_permissions (role_id, object_id, access_level)
                VALUES (?, ?, ?)
                ON CONFLICT (role_id, object_id) DO UPDATE SET access_level = EXCLUDED.access_level
            ");
            $stmt->execute([$roleId, $objectId, $accessLevel]);
            echo json_encode(['success' => true]);
            break;

        case 'set_permissions_bulk':
            // Set multiple permissions at once for a role
            $data = json_decode(file_get_contents('php://input'), true);
            $roleId = $data['role_id'];
            $permissions = $data['permissions']; // [{object_id, access_level}, ...]

            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare("
                    INSERT INTO sys_security_permissions (role_id, object_id, access_level)
                    VALUES (?, ?, ?)
                    ON CONFLICT (role_id, object_id) DO UPDATE SET access_level = EXCLUDED.access_level
                ");
                foreach ($permissions as $perm) {
                    $stmt->execute([$roleId, $perm['object_id'], $perm['access_level']]);
                }
                $pdo->commit();
                echo json_encode(['success' => true]);
            } catch (Exception $e) {
                $pdo->rollBack();
                throw $e;
            }
            break;

        case 'remove_permission':
            $data = json_decode(file_get_contents('php://input'), true);
            $stmt = $pdo->prepare("DELETE FROM sys_security_permissions WHERE role_id = ? AND object_id = ?");
            $stmt->execute([$data['role_id'], $data['object_id']]);
            echo json_encode(['success' => true]);
            break;

        // =====================
        // USER PERMISSIONS CHECK (Core for frontend)
        // =====================
        case 'check_user_permissions':
            // Get current user's effective permissions
            $userId = $_GET['user_id'] ?? null;
            
            if (!$userId) {
                // Try to get from session/auth
                session_start();
                $userId = $_SESSION['user_id'] ?? null;
            }

            if (!$userId) {
                echo json_encode(['success' => true, 'data' => [], 'is_admin' => false]);
                break;
            }

            // Check if user has ADMIN role
            $adminCheck = $pdo->prepare("
                SELECT 1 FROM sys_user_roles ur
                JOIN sys_security_roles r ON r.rec_id = ur.role_id
                WHERE ur.user_id = ? AND r.code = 'ADMIN'
            ");
            $adminCheck->execute([$userId]);
            $isAdmin = (bool)$adminCheck->fetchColumn();

            if ($isAdmin) {
                // Admin gets full access to everything
                $stmt = $pdo->query("SELECT identifier, 3 as access_level FROM sys_security_objects");
                $perms = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
                echo json_encode(['success' => true, 'data' => $perms, 'is_admin' => true]);
                break;
            }

            // Get aggregated permissions for user's roles (MAX access level wins)
            $stmt = $pdo->prepare("
                SELECT o.identifier, MAX(p.access_level) as access_level
                FROM sys_user_roles ur
                JOIN sys_security_permissions p ON p.role_id = ur.role_id
                JOIN sys_security_objects o ON o.rec_id = p.object_id
                WHERE ur.user_id = ?
                GROUP BY o.identifier
            ");
            $stmt->execute([$userId]);
            $perms = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
            echo json_encode(['success' => true, 'data' => $perms, 'is_admin' => false]);
            break;

        // =====================
        // USER ROLE ASSIGNMENT
        // =====================
        case 'get_user_roles':
            $userId = $_GET['user_id'] ?? 0;
            $stmt = $pdo->prepare("
                SELECT r.rec_id, r.code, r.description
                FROM sys_user_roles ur
                JOIN sys_security_roles r ON r.rec_id = ur.role_id
                WHERE ur.user_id = ?
            ");
            $stmt->execute([$userId]);
            echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
            break;

        case 'assign_user_role':
            $data = json_decode(file_get_contents('php://input'), true);
            $stmt = $pdo->prepare("INSERT INTO sys_user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
            $stmt->execute([$data['user_id'], $data['role_id']]);
            echo json_encode(['success' => true]);
            break;

        case 'remove_user_role':
            $data = json_decode(file_get_contents('php://input'), true);
            $stmt = $pdo->prepare("DELETE FROM sys_user_roles WHERE user_id = ? AND role_id = ?");
            $stmt->execute([$data['user_id'], $data['role_id']]);
            echo json_encode(['success' => true]);
            break;

        default:
            echo json_encode(['success' => false, 'error' => 'Unknown action: ' . $action]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
