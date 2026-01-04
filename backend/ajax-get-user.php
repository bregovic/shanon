<?php
// backend/ajax-get-user.php
require_once 'cors.php'; 
require_once 'session_init.php';

// PERFORMANCE FIX: 
// Okamžitě uzavřít session pro zápis. Tím uvolníme zámek pro ostatní skripty (jako login nebo další requesty).
// Protože zde session data jen ČTEME a neměníme, je to bezpečné a výrazně to zrychlí souběžné požadavky.
session_write_close();

header("Content-Type: application/json");

if (isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true) {
    require_once 'db.php';
    
    $user = $_SESSION['user'] ?? null;
    $permissions = [];
    $rolesList = [];

    if ($user && isset($user['rec_id'])) {
        try {
            $pdo = DB::connect();
            
            // 1. Resolve effective Role IDs
            // Combine strict RBAC roles (sys_user_roles) with legacy session roles mapping
            $roleCodes = [];
            if (isset($user['roles'])) {
                // Legacy support: map 'admin' -> 'ADMIN'
                if (is_array($user['roles'])) {
                    foreach($user['roles'] as $r) $roleCodes[] = strtoupper($r);
                } else if (is_string($user['roles'])) {
                     // Handle potential JSON string or single value
                     $decoded = json_decode($user['roles']);
                     if (is_array($decoded)) foreach($decoded as $r) $roleCodes[] = strtoupper($r);
                     else $roleCodes[] = strtoupper($user['roles']);
                }
            }
            // Always ensure GUEST
            $roleCodes[] = 'GUEST'; 

            // Get IDs for these codes + explicit DB assignments
            $placeholders = str_repeat('?,', count($roleCodes) - 1) . '?';
            
            // Complex query to get all permissions for user's effective roles
            // We select MAX access_level for each object identifier
            $sql = "
                SELECT obj.identifier, MAX(perm.access_level) as level
                FROM sys_security_permissions perm
                JOIN sys_security_objects obj ON perm.object_id = obj.rec_id
                JOIN sys_security_roles role ON perm.role_id = role.rec_id
                WHERE 
                    role.code IN ($placeholders) -- Legacy/Session based roles
                    OR role.rec_id IN (SELECT role_id FROM sys_user_roles WHERE user_id = ?) -- DB based roles
                GROUP BY obj.identifier
            ";

            $params = array_merge($roleCodes, [$user['rec_id']]);
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $permissions = [];
            foreach ($rows as $row) {
                $permissions[$row['identifier']] = (int)$row['level'];
            }

            // Special Admin Override: If user has ADMIN role, give logic-level override if needed, 
            // but the SQL above handles it if ADMIN role has entries in permissions table.
            if (in_array('ADMIN', $roleCodes)) {
                $rolesList[] = 'ADMIN';
            }

        } catch (Exception $e) {
            // Log error silently, return basic user info
            error_log("RBAC Error: " . $e->getMessage());
        }
    }

    echo json_encode([
        'success' => true,
        'is_logged_in' => true,
        'user' => $user,
        'permissions' => $permissions
    ]);

} else {
    echo json_encode(['success' => false, 'is_logged_in' => false]);
}
