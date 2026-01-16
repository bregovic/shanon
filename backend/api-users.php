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
            $stmt = $pdo->prepare("
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
            $stmt->execute([':tid' => $_SESSION['user']['tenant_id'] ?? $_SESSION['tenant_id'] ?? '00000000-0000-0000-0000-000000000001']);
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
            $tenantId = $_SESSION['user']['tenant_id'] ?? $_SESSION['tenant_id'] ?? null;
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

        case 'get_security_details':
            $targetUserId = $_GET['id'] ?? null;
            if (!$targetUserId) throw new Exception("Target User ID required");

            $sessionTenantId = $_SESSION['user']['tenant_id'] ?? $_SESSION['tenant_id'] ?? '00000000-0000-0000-0000-000000000001';

            // 1. Get User Profile Settings
            $stmtUser = $pdo->prepare("SELECT settings FROM sys_users WHERE rec_id = :id");
            $stmtUser->execute([':id' => $targetUserId]);
            $userRow = $stmtUser->fetch(PDO::FETCH_ASSOC);
            $settings = $userRow && $userRow['settings'] ? json_decode($userRow['settings'], true) : [];

            // 2. Get Org Access Matrix (All Orgs + User Status)
            // Rule 2A: Explicitly enforce WHERE tenant_id = :tid
            $tenantId = $_SESSION['user']['tenant_id'] ?? $_SESSION['tenant_id'] ?? null;
            if (!$tenantId) {
                // Fallback or error? For listing, we might default to a safe-fail or the default tenant if configured.
                // Assuming '00000000-0000-0000-0000-000000000001' is the dev/default one.
                $tenantId = '00000000-0000-0000-0000-000000000001';
            }

            $sqlMatrix = "
                SELECT 
                    o.org_id, 
                    o.display_name,
                    ua.roles,
                    ua.is_active,
                    (ua.user_id IS NOT NULL) as is_assigned
                FROM sys_organizations o
                LEFT JOIN sys_user_org_access ua ON o.org_id = ua.org_id AND ua.user_id = :uid
                WHERE o.tenant_id = :tid AND o.is_active = true
                ORDER BY o.display_name ASC
            ";
            
            $stmtMatrix = $pdo->prepare($sqlMatrix);
            $stmtMatrix->execute([
                ':uid' => $targetUserId,
                ':tid' => $tenantId
            ]);
            $matrix = $stmtMatrix->fetchAll(PDO::FETCH_ASSOC);

            // Normalize roles
            foreach($matrix as &$row) {
                // If it's a JSON string from DB, decode it. If it's already an array (unlikely with PDO/MySQL default), keep it.
                if (isset($row['roles'])) { // check if exists
                     if (is_string($row['roles'])) {
                        $decoded = json_decode($row['roles'], true);
                        $row['roles'] = is_array($decoded) ? $decoded : [];
                    } elseif (!is_array($row['roles'])) {
                        $row['roles'] = [];
                    }
                } else {
                    $row['roles'] = [];
                }
                
                // Ensure booleans
                $row['is_assigned'] = (bool)$row['is_assigned'];
                $row['is_active'] = (bool)$row['is_active'];
            }

            // Extract org_access from matrix for compatibility with Frontend UserSettingsDialog
            $org_access = [];
            foreach ($matrix as $m) {
                if ($m['is_assigned']) {
                    $org_access[] = [
                        'user_id' => $targetUserId,
                        'org_id'  => $m['org_id'],
                        'roles'   => $m['roles'],
                        'is_active' => $m['is_active']
                    ];
                }
            }

            echo json_encode([
                'success' => true, 
                'settings' => $settings,
                'matrix' => $matrix,
                'org_access' => $org_access
            ]);
            break;

        case 'save_security_details':
            $input = json_decode(file_get_contents('php://input'), true);
            $targetUserId = $input['user_id'] ?? null;
            if (!$targetUserId) throw new Exception("Target User ID required");

            DB::transaction(function($pdo) use ($targetUserId, $input) {
                // 1. Save Settings (Language, Default Org)
                if (isset($input['settings'])) {
                    // Fetch existing to merge
                    $sStmt = $pdo->prepare("SELECT settings FROM sys_users WHERE rec_id = :id");
                    $sStmt->execute([':id' => $targetUserId]);
                    $curr = $sStmt->fetch(PDO::FETCH_ASSOC);
                    $currSettings = $curr && $curr['settings'] ? json_decode($curr['settings'], true) : [];
                    
                    // Merge
                    $newSettings = array_merge($currSettings, $input['settings']);
                    $pdo->prepare("UPDATE sys_users SET settings = :json, updated_at = NOW() WHERE rec_id = :id")
                        ->execute([':json' => json_encode($newSettings), ':id' => $targetUserId]);
                }

                // 2. Save Org Access
                if (isset($input['org_access']) && is_array($input['org_access'])) {
                    // Strategy: Delete all and re-insert is easiest for full sync, 
                    // or upsert. Let's do selective Upsert/Delete.
                    // For simplicity in this Wizard approach: Sync (Delete missing, Upsert provided)
                    
                    // Get current IDs in DB
                    $existingStmt = $pdo->prepare("SELECT org_id FROM sys_user_org_access WHERE user_id = :uid");
                    $existingStmt->execute([':uid' => $targetUserId]);
                    $existingOrgs = $existingStmt->fetchAll(PDO::FETCH_COLUMN);

                    $incomingOrgs = array_column($input['org_access'], 'org_id');

                    // Delete removed
                    $toDelete = array_diff($existingOrgs, $incomingOrgs);
                    if (!empty($toDelete)) {
                        $delPlaceholders = implode(',', array_fill(0, count($toDelete), '?'));
                        $delStmt = $pdo->prepare("DELETE FROM sys_user_org_access WHERE user_id = ? AND org_id IN ($delPlaceholders)");
                        $delStmt->execute(array_merge([$targetUserId], $toDelete));
                    }

                    // Upsert incoming
                    $upsertSql = "INSERT INTO sys_user_org_access (user_id, org_id, roles, is_active) 
                                  VALUES (:uid, :oid, :roles, true)
                                  ON CONFLICT (user_id, org_id) 
                                  DO UPDATE SET roles = EXCLUDED.roles, updated_at = NOW()";
                    $upsertStmt = $pdo->prepare($upsertSql);

                    foreach ($input['org_access'] as $item) {
                        $upsertStmt->execute([
                            ':uid' => $targetUserId,
                            ':oid' => $item['org_id'],
                            ':roles' => json_encode($item['roles'] ?? [])
                        ]);
                    }
                }
            });

            echo json_encode(['success' => true, 'message' => 'Security details updated']);
            break;

        default:
            throw new Exception("Unknown action: $action");
    }
    
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
