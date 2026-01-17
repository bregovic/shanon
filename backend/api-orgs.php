<?php
// backend/api-orgs.php
require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header("Content-Type: application/json");

// 1. Security Barrier (Standard Requirement)
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// 2. Tenant Context
$tenantId = $_SESSION['user']['tenant_id'] ?? null;
if (!$tenantId) {
    http_response_code(400); // Bad Request
    echo json_encode(['success' => false, 'error' => 'No Tenant Context']);
    exit;   
}

$action = $_GET['action'] ?? $_POST['action'] ?? 'list';

try {
    $pdo = DB::connect();
    
    switch ($action) {
        case 'list':
            // Support filtering by virtual type
            $type = $_GET['type'] ?? null; // 'virtual', 'standard', or null (all)
            
            $sql = "SELECT * FROM sys_organizations WHERE tenant_id = :tid";
            $params = [':tid' => $tenantId];

            if ($type === 'virtual') {
                $sql .= " AND is_virtual_group = true";
            } elseif ($type === 'standard') {
                // Compatible with existing frontend which doesn't know about virtual groups yet
                // or explicit standard check
                $sql .= " AND (is_virtual_group = false OR is_virtual_group IS NULL)";
            }

            $sql .= " ORDER BY org_id";

            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            // Normalize boolean
            foreach ($data as &$row) {
                $row['is_active'] = (bool)$row['is_active'];
                $row['is_virtual_group'] = !empty($row['is_virtual_group']);
            }

            echo json_encode(['success' => true, 'data' => $data]);
            break;

        case 'create':
            $input = json_decode(file_get_contents('php://input'), true);
            
            // Validate ID (max 5 chars)
            $orgId = strtoupper(trim($input['org_id'] ?? ''));
            if (!preg_match('/^[A-Z0-9]{1,5}$/', $orgId)) {
                throw new Exception("ID společnosti musí mít 1-5 znaků (A-Z, 0-9).");
            }
            if (empty($input['display_name'])) throw new Exception("Název společnosti je povinný.");

            $isVirtual = !empty($input['is_virtual_group']);

            // Check duplicities within Tenant
            $check = $pdo->prepare("SELECT 1 FROM sys_organizations WHERE org_id = :oid");
            $check->execute([':oid' => $orgId]);
            if ($check->fetch()) throw new Exception("Společnost s ID '$orgId' již existuje.");

            $sql = "INSERT INTO sys_organizations (
                org_id, tenant_id, display_name, reg_no, tax_no, 
                street, city, zip, 
                contact_email, contact_phone, 
                bank_account, bank_code, data_box_id,
                is_active, is_virtual_group
            ) VALUES (
                :oid, :tid, :name, :ico, :dic,
                :street, :city, :zip,
                :email, :phone,
                :bank, :bank_code, :dbox,
                true, :is_virtual
            )";

            $stmt = $pdo->prepare($sql);
            $stmt->execute([
                ':oid' => $orgId,
                ':tid' => $tenantId,
                ':name' => $input['display_name'],
                ':ico' => $input['reg_no'] ?? null,
                ':dic' => $input['tax_no'] ?? null,
                ':street' => $input['street'] ?? null,
                ':city' => $input['city'] ?? null,
                ':zip' => $input['zip'] ?? null,
                ':email' => $input['contact_email'] ?? null,
                ':phone' => $input['contact_phone'] ?? null,
                ':bank' => $input['bank_account'] ?? null,
                ':bank_code' => $input['bank_code'] ?? null,
                ':dbox' => $input['data_box_id'] ?? null,
                ':is_virtual' => $isVirtual ? 'true' : 'false'
            ]);

            // Automatically grant access to the creator
            $currentUserId = $_SESSION['user']['id'] ?? $_SESSION['user_id'] ?? null;
            if ($currentUserId) {
                $accessSql = "INSERT INTO sys_user_org_access (user_id, org_id, is_default) VALUES (:uid, :oid, false) ON CONFLICT DO NOTHING";
                $pdo->prepare($accessSql)->execute([':uid' => $currentUserId, ':oid' => $orgId]);
            }

            echo json_encode(['success' => true, 'message' => 'Organizace vytvořena.']);
            break;

        case 'update':
            $input = json_decode(file_get_contents('php://input'), true);
            $orgId = $input['org_id'] ?? null;
            if (!$orgId) throw new Exception("Chybí ID organizace.");

            $sets = [];
            $params = [':oid' => $orgId, ':tid' => $tenantId];

            $fields = [
                'display_name' => 'display_name',
                'reg_no' => 'reg_no',
                'tax_no' => 'tax_no',
                'street' => 'street',
                'city' => 'city',
                'zip' => 'zip',
                'contact_email' => 'contact_email',
                'contact_phone' => 'contact_phone',
                'bank_account' => 'bank_account',
                'bank_code' => 'bank_code',
                'data_box_id' => 'data_box_id',
                'is_active' => 'is_active',
                'is_virtual_group' => 'is_virtual_group'
            ];

            foreach ($fields as $jsonKey => $dbCol) {
                if (array_key_exists($jsonKey, $input)) {
                    $sets[] = "$dbCol = :$dbCol";
                    // Special handling for boolean
                    if ($jsonKey === 'is_active' || $jsonKey === 'is_virtual_group') {
                        $params[":$dbCol"] = (bool)$input[$jsonKey] ? 'true' : 'false';
                    } else {
                        $params[":$dbCol"] = $input[$jsonKey];
                    }
                }
            }
            
            $sets[] = "updated_at = NOW()";

            if (empty($sets)) throw new Exception("Žádná data k úpravě.");

            $sql = "UPDATE sys_organizations SET " . implode(', ', $sets) . " WHERE org_id = :oid AND tenant_id = :tid";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);

            echo json_encode(['success' => true, 'message' => 'Uloženo.']);
            break;

        case 'delete':
            $input = json_decode(file_get_contents('php://input'), true);
            $ids = $input['ids'] ?? [];
            if (empty($ids)) throw new Exception("Nebyl vybrán žádný záznam.");

            // Safe Delete with placeholder expansion
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            // IMPORTANT: Tenant check in DELETE
            $sql = "DELETE FROM sys_organizations WHERE tenant_id = ? AND org_id IN ($placeholders)";
            
            $params = array_merge([$tenantId], $ids);
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);

            echo json_encode(['success' => true, 'message' => 'Smazáno.', 'count' => $stmt->rowCount()]);
            break;

        // --- SHARED COMPANIES LOGIC ---

        case 'get_group_members':
            $groupId = $_GET['group_id'] ?? '';
            if (!$groupId) throw new Exception("Group ID required");

            // Get All Active Standard Orgs (Available)
            $stmtAll = $pdo->prepare("SELECT org_id, display_name FROM sys_organizations WHERE tenant_id = :tid AND (is_virtual_group = false OR is_virtual_group IS NULL) AND is_active = true");
            $stmtAll->execute([':tid' => $tenantId]);
            $allOrgs = $stmtAll->fetchAll(PDO::FETCH_ASSOC);

            // Get Assigned Members
            $stmtAssigned = $pdo->prepare("SELECT member_id FROM sys_org_group_members WHERE group_id = :gid");
            $stmtAssigned->execute([':gid' => $groupId]);
            $assignedIds = $stmtAssigned->fetchAll(PDO::FETCH_COLUMN);

            echo json_encode([
                'success' => true,
                'available_orgs' => $allOrgs,
                'assigned_ids' => $assignedIds
            ]);
            break;

        case 'save_group_members':
            $input = json_decode(file_get_contents('php://input'), true);
            $groupId = $input['group_id'] ?? '';
            $memberIds = $input['member_ids'] ?? [];

            if (!$groupId) throw new Exception("Group ID required");

            DB::transaction(function($pdo) use ($groupId, $memberIds) {
                // Delete existing
                $del = $pdo->prepare("DELETE FROM sys_org_group_members WHERE group_id = ?");
                $del->execute([$groupId]);

                // Insert new
                if (!empty($memberIds)) {
                    $ins = $pdo->prepare("INSERT INTO sys_org_group_members (group_id, member_id) VALUES (?, ?)");
                    foreach ($memberIds as $mid) {
                        $ins->execute([$groupId, $mid]);
                    }
                }
            });

            echo json_encode(['success' => true, 'message' => 'Členové skupiny aktualizováni']);
            break;

        case 'get_shared_tables':
            $groupId = $_GET['group_id'] ?? '';
            if (!$groupId) throw new Exception("Group ID required");

            // 1. Get List of All Tables in Schema (simple whitelist or introspection)
            // Ideally we query information_schema, but limit to 'public' schema and exclude system tables if possible.
            // For safety, let's filter only known prefixes like 'sys_', 'dms_' or allow all for 'public'.
            $stmtTables = $pdo->query("
                SELECT DISTINCT t.table_name 
                FROM information_schema.tables t
                JOIN information_schema.columns c ON c.table_name = t.table_name AND c.table_schema = t.table_schema
                WHERE t.table_schema = 'public' 
                AND t.table_type = 'BASE TABLE'
                AND c.column_name = 'tenant_id'
                ORDER BY t.table_name
            ");
            $allTablesRaw = $stmtTables->fetchAll(PDO::FETCH_COLUMN);
            
            // Format for TransferList
            $allTables = array_map(function($t) { return ['id' => $t, 'display_name' => $t]; }, $allTablesRaw);

            // 2. Get Assigned Tables
            $stmtAssigned = $pdo->prepare("SELECT table_name FROM sys_org_shared_tables WHERE group_id = :gid");
            $stmtAssigned->execute([':gid' => $groupId]);
            $assignedTables = $stmtAssigned->fetchAll(PDO::FETCH_COLUMN);

            echo json_encode([
                'success' => true,
                'all_tables' => $allTables,
                'assigned_tables' => $assignedTables
            ]);
            break;

        case 'save_shared_tables':
            $input = json_decode(file_get_contents('php://input'), true);
            $groupId = $input['group_id'] ?? '';
            $tableNames = $input['table_names'] ?? [];

            if (!$groupId) throw new Exception("Group ID required");

            DB::transaction(function($pdo) use ($groupId, $tableNames) {
                // Delete existing
                $del = $pdo->prepare("DELETE FROM sys_org_shared_tables WHERE group_id = ?");
                $del->execute([$groupId]);

                // Insert new
                if (!empty($tableNames)) {
                    $ins = $pdo->prepare("INSERT INTO sys_org_shared_tables (group_id, table_name) VALUES (?, ?)");
                    foreach ($tableNames as $tbl) {
                        $ins->execute([$groupId, $tbl]);
                    }
                }
            });

            echo json_encode(['success' => true, 'message' => 'Konfigurace tabulek uložena']);
            break;

        default:
            throw new Exception("Neznámá akce.");
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
