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
            // Standard List Query with Tenant Isolation
            $stmt = $pdo->prepare("
                SELECT * 
                FROM sys_organizations 
                WHERE tenant_id = :tid 
                ORDER BY org_id
            ");
            $stmt->execute([':tid' => $tenantId]);
            $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
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

            // Check duplicities within Tenant (or globally since OrgID is PK? It's PK char(5), so global uniqueness required currently)
            // TODO: In future, composite PK (tenant_id, org_id) would be better, but for now strict 5 char is global or we assume small deployment.
            // Let's check DB.
            $check = $pdo->prepare("SELECT 1 FROM sys_organizations WHERE org_id = :oid");
            $check->execute([':oid' => $orgId]);
            if ($check->fetch()) throw new Exception("Společnost s ID '$orgId' již existuje.");

            $sql = "INSERT INTO sys_organizations (
                org_id, tenant_id, display_name, reg_no, tax_no, 
                street, city, zip, 
                contact_email, contact_phone, 
                bank_account, bank_code, data_box_id,
                is_active
            ) VALUES (
                :oid, :tid, :name, :ico, :dic,
                :street, :city, :zip,
                :email, :phone,
                :bank, :bank_code, :dbox,
                true
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
                ':dbox' => $input['data_box_id'] ?? null
            ]);

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
                'is_active' => 'is_active' // boolean
            ];

            foreach ($fields as $jsonKey => $dbCol) {
                if (array_key_exists($jsonKey, $input)) {
                    $sets[] = "$dbCol = :$dbCol";
                    // Special handling for boolean
                    if ($jsonKey === 'is_active') {
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
            
            // Allow deleting only if not current context? 
            // Better to prevent self-deletion in frontend, but backend should ideally check relations.
            
            $params = array_merge([$tenantId], $ids);
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);

            echo json_encode(['success' => true, 'message' => 'Smazáno.', 'count' => $stmt->rowCount()]);
            break;

        default:
            throw new Exception("Neznámá akce.");
    }

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
