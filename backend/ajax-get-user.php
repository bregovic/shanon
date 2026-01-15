<?php
// backend/ajax-get-user.php
require_once 'cors.php'; 
require_once 'session_init.php';

// PERFORMANCE NOTE: 
// Previously had session_write_close() here for performance.
// Removed because Multi-Org context may need to write to DB (auto-assign fallback).
// If performance issues arise, reconsider architecture.

header("Content-Type: application/json");

if (isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true) {
    require_once 'db.php';
    
    $user = $_SESSION['user'] ?? null;
    $permissions = [];
    $rolesList = [];
    
    // Get user ID - support both 'id' and 'rec_id' field names
    $userId = $user['rec_id'] ?? $user['id'] ?? null;

    if ($user && $userId) {
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

            // Check if RBAC tables exist before querying
            $tableCheck = $pdo->query("SELECT to_regclass('sys_security_permissions')");
            $tableExists = $tableCheck->fetchColumn();
            
            if ($tableExists) {
                // Complex query to get all permissions for user's effective roles
                // We select MAX access_level for each object identifier
                $placeholders = str_repeat('?,', count($roleCodes) - 1) . '?';
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

                $params = array_merge($roleCodes, [$userId]);
                $stmt = $pdo->prepare($sql);
                $stmt->execute($params);
            
                $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
                foreach ($rows as $row) {
                    $permissions[$row['identifier']] = (int)$row['level'];
                }
            }
            // else: RBAC tables don't exist yet, continue with empty permissions

            // Special Admin Override: If user has ADMIN role, give logic-level override if needed, 
            // but the SQL above handles it if ADMIN role has entries in permissions table.
            if (in_array('ADMIN', $roleCodes)) {
                $rolesList[] = 'ADMIN';
            }

        } catch (Exception $e) {
            // Log error silently, return basic user info
            error_log("RBAC Error: " . $e->getMessage());
        }
        
        // 2. Multi-Org Context
        $availableOrgs = [];
        $currentOrgId = $_SESSION['current_org_id'] ?? null;
        
        try {
             // Check if tables exist (robustness against partial migration)
             $orgTableExists = $pdo->query("SELECT to_regclass('sys_organizations')")->fetchColumn();
             
             if ($orgTableExists) {
                 // Admin Override: Admins see ALL organizations
                 // Check session role (admin, superadmin) and roleCodes
                 $userRole = strtolower($_SESSION['user']['role'] ?? '');
                 $isAdmin = in_array($userRole, ['admin', 'superadmin']) 
                         || in_array('ADMIN', $roleCodes ?? [])
                         || in_array('SUPERADMIN', $roleCodes ?? []);
                 
                 if ($isAdmin) {
                     $sql = "
                        SELECT o.org_id, o.display_name, COALESCE(a.is_default, false) as is_default
                        FROM sys_organizations o
                        LEFT JOIN sys_user_org_access a ON o.org_id = a.org_id AND a.user_id = :uid
                        WHERE o.is_active = true
                        ORDER BY o.display_name
                     ";
                 } else {
                     $sql = "
                        SELECT o.org_id, o.display_name, a.is_default
                        FROM sys_user_org_access a
                        JOIN sys_organizations o ON a.org_id = o.org_id
                        WHERE a.user_id = :uid AND o.is_active = true
                        ORDER BY o.display_name
                     ";
                 }
                 
                 $stmt = $pdo->prepare($sql);
                 $stmt->execute([':uid' => $userId]);
                 $availableOrgs = $stmt->fetchAll(PDO::FETCH_ASSOC);
                 
                 // Fallback: If no orgs found and user is logged in, assign them to first available org
                 if (empty($availableOrgs)) {
                     // Try to get any active organization
                     $stmt = $pdo->query("SELECT org_id, display_name, false as is_default FROM sys_organizations WHERE is_active = true ORDER BY org_id LIMIT 1");
                     $fallbackOrg = $stmt->fetch(PDO::FETCH_ASSOC);
                     
                     if ($fallbackOrg) {
                         // Auto-assign user to this org
                         $pdo->prepare("INSERT INTO sys_user_org_access (user_id, org_id, is_default) VALUES (:uid, :oid, true) ON CONFLICT DO NOTHING")
                             ->execute([':uid' => $userId, ':oid' => $fallbackOrg['org_id']]);
                         $fallbackOrg['is_default'] = true;
                         $availableOrgs = [$fallbackOrg];
                     }
                 }

                 // Determine effective current Org (Transient default if session empty)
                 if (!$currentOrgId && !empty($availableOrgs)) {
                      foreach ($availableOrgs as $org) {
                          if ($org['is_default']) {
                              $currentOrgId = $org['org_id'];
                              break;
                          }
                      }
                      if (!$currentOrgId) $currentOrgId = $availableOrgs[0]['org_id'];
                 }
             }
        } catch (Exception $e) {
             error_log("Multi-Org Error: " . $e->getMessage());
        }
    }

    echo json_encode([
        'success' => true,
        'is_logged_in' => true,
        'user' => $user,
        'permissions' => $permissions,
        'organizations' => $availableOrgs,
        'current_org_id' => $currentOrgId
    ]);

} else {
    echo json_encode(['success' => false, 'is_logged_in' => false]);
}
