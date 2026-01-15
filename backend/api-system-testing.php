<?php
// api-system-testing.php
// Dedicated API for the new Testing Module

require_once 'config.php';
require_once 'vendor/autoload.php';

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? '';
$currentUser = 'Admin'; // Todo: Auth
$tenantId = '00000000-0000-0000-0000-000000000001';

try {
    $pdo = getDB();

    // 1. LIST SCENARIOS
    if ($action === 'list_scenarios') {
        $category = $_GET['category'] ?? ''; // 'process', 'feature', 'critical_path'
        
        $sql = "SELECT s.*, 
                (SELECT COUNT(*) FROM sys_test_steps st WHERE st.scenario_id = s.rec_id) as step_count,
                (SELECT overall_status FROM sys_test_runs r WHERE r.scenario_id = s.rec_id ORDER BY run_date DESC LIMIT 1) as last_status,
                (SELECT run_date FROM sys_test_runs r WHERE r.scenario_id = s.rec_id ORDER BY run_date DESC LIMIT 1) as last_run_date
                FROM sys_test_scenarios s 
                WHERE s.tenant_id = :tid";
        
        $params = [':tid' => $tenantId];
        if ($category) {
            $sql .= " AND s.category = :cat";
            $params[':cat'] = $category;
        }
        $sql .= " ORDER BY s.title ASC";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'data' => $data]);
        exit;
    }

    // 2. GET SCENARIO DETAIL (With Steps)
    if ($action === 'get_scenario') {
        $id = $_GET['id'] ?? 0;
        if (!$id) throw new Exception('ID required');

        // Header
        $stmt = $pdo->prepare("SELECT * FROM sys_test_scenarios WHERE rec_id = :id");
        $stmt->execute([':id' => $id]);
        $scenario = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$scenario) throw new Exception('Scenario not found');

        // Steps
        $stmtSteps = $pdo->prepare("SELECT * FROM sys_test_steps WHERE scenario_id = :id ORDER BY step_order ASC");
        $stmtSteps->execute([':id' => $id]);
        $steps = $stmtSteps->fetchAll(PDO::FETCH_ASSOC);

        // Recent Runs (History)
        $stmtRuns = $pdo->prepare("SELECT * FROM sys_test_runs WHERE scenario_id = :id ORDER BY run_date DESC LIMIT 10");
        $stmtRuns->execute([':id' => $id]);
        $runs = $stmtRuns->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'data' => [
            'scenario' => $scenario,
            'steps' => $steps,
            'runs' => $runs
        ]]);
        exit;
    }

    // 3. CREATE/UPDATE SCENARIO
    if ($action === 'save_scenario' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        
        $id = $input['rec_id'] ?? 0;
        $title = $input['title'] ?? 'New Scenario';
        $desc = $input['description'] ?? '';
        $cat = $input['category'] ?? 'feature';
        $steps = $input['steps'] ?? [];

        if ($id) {
            // Update
            $sql = "UPDATE sys_test_scenarios SET title = :t, description = :d, category = :c, updated_at = NOW() WHERE rec_id = :id";
            $pdo->prepare($sql)->execute([':t' => $title, ':d' => $desc, ':c' => $cat, ':id' => $id]);
            $scenarioId = $id;
        } else {
            // Insert
            $sql = "INSERT INTO sys_test_scenarios (tenant_id, title, description, category, created_by) VALUES (:tid, :t, :d, :c, :u) RETURNING rec_id";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([':tid' => $tenantId, ':t' => $title, ':d' => $desc, ':c' => $cat, ':u' => $currentUser]);
            $scenarioId = $stmt->fetchColumn();
        }

        // Sync Steps: Rudimentary approach - Delete all and re-insert (simple for sorting)
        // Or smarter update. For now, Delete All is safest for order consistencies.
        // NOTE: This loses history if steps are linked to runs??
        // Wait. `sys_test_run_results` links to `step_id`.
        // If we delete steps, we corrupt old run results. We SHOULD NOT delete steps that have history.
        // For now, let's implement UPSERT logic for steps using ID.

        $newIds = [];
        $order = 1;
        foreach ($steps as $step) {
            $stepId = $step['rec_id'] ?? 0;
            $instr = $step['instruction'] ?? '';
            $exp = $step['expected_result'] ?? '';

            if ($stepId) {
                // Update
                $sqlS = "UPDATE sys_test_steps SET step_order = :o, instruction = :i, expected_result = :e WHERE rec_id = :id";
                $pdo->prepare($sqlS)->execute([':o' => $order, ':i' => $instr, ':e' => $exp, ':id' => $stepId]);
                $newIds[] = $stepId;
            } else {
                // Insert
                $sqlS = "INSERT INTO sys_test_steps (scenario_id, step_order, instruction, expected_result) VALUES (:sid, :o, :i, :e) RETURNING rec_id";
                $stmtS = $pdo->prepare($sqlS);
                $stmtS->execute([':sid' => $scenarioId, ':o' => $order, ':i' => $instr, ':e' => $exp]);
                $newIds[] = $stmtS->fetchColumn();
            }
            $order++;
        }

        // Delete removed steps? Only if they have no runs?
        // Or just mark them deleted? For simplicity, we skip deleting for now to preserve data.
        // Ideally: DELETE FROM sys_test_steps WHERE scenario_id = :sid AND rec_id NOT IN (...newIds)

        if (!empty($newIds)) {
             $placeholders = implode(',', array_fill(0, count($newIds), '?'));
             $sqlDel = "DELETE FROM sys_test_steps WHERE scenario_id = ? AND rec_id NOT IN ($placeholders)";
             // BUT, check constraint. Postgres will throw error if linked to results.
             // We'll wrap in try-catch or just suppress.
             try {
                $args = array_merge([$scenarioId], $newIds);
                $pdo->prepare($sqlDel)->execute($args);
             } catch (Exception $e) {
                 // Ignore FK constraint error for now - user can't delete steps with history
             }
        }

        echo json_encode(['success' => true, 'id' => $scenarioId]);
        exit;
    }

    // 4. START NEW RUN
    if ($action === 'start_run' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $scenarioId = $input['scenario_id'];
        $version = $input['version_tag'] ?? '';
        
        $sql = "INSERT INTO sys_test_runs (scenario_id, run_by, version_tag) VALUES (:sid, :u, :v) RETURNING rec_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([':sid' => $scenarioId, ':u' => $currentUser, ':v' => $version]);
        $runId = $stmt->fetchColumn();

        // Optional: Pre-fill results as 'none'
        // Not strictly necessary if frontend handles it, but good for reporting.
        $stmtSteps = $pdo->prepare("SELECT rec_id FROM sys_test_steps WHERE scenario_id = :sid");
        $stmtSteps->execute([':sid' => $scenarioId]);
        $steps = $stmtSteps->fetchAll(PDO::FETCH_COLUMN);

        /*
        foreach($steps as $sId) {
            $pdo->prepare("INSERT INTO sys_test_run_results (run_id, step_id) VALUES (?, ?)")
                ->execute([$runId, $sId]);
        }
        */

        echo json_encode(['success' => true, 'run_id' => $runId]);
        exit;
    }

    // 5. UPDATE RUN RESULT (Checkboxes)
    if ($action === 'update_run_result' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $runId = $input['run_id'];
        $stepId = $input['step_id'];
        $status = $input['status']; // 'ok', 'nok', 'na'
        $comment = $input['comment'] ?? '';

        // Upsert result
        // Postgres UPSERT 
        $sql = "INSERT INTO sys_test_run_results (run_id, step_id, status, comment, updated_at)
                VALUES (:rid, :sid, :stat, :com, NOW())
                ON CONFLICT (rec_id) DO UPDATE SET status = :stat, comment = :com, updated_at = NOW()";
        
        // Wait, I didn't verify uniqueness on run_id+step_id in table definition. 
        // I define PK on rec_id. I should check if exists first.
        $check = $pdo->prepare("SELECT rec_id FROM sys_test_run_results WHERE run_id = :rid AND step_id = :sid");
        $check->execute([':rid' => $runId, ':sid' => $stepId]);
        $existingId = $check->fetchColumn();

        if ($existingId) {
             $pdo->prepare("UPDATE sys_test_run_results SET status=:s, comment=:c, updated_at=NOW() WHERE rec_id=:id")
                 ->execute([':s'=>$status, ':c'=>$comment, ':id'=>$existingId]);
        } else {
             $pdo->prepare("INSERT INTO sys_test_run_results (run_id, step_id, status, comment) VALUES (:rid, :sid, :s, :c)")
                 ->execute([':rid'=>$runId, ':sid'=>$stepId, ':s'=>$status, ':c'=>$comment]);
        }
        
        // Update Run Overall Status?
        // Basic logic: if any NOK -> Failed. If all OK -> Passed.
        // We can do this async or lazy.
        
        echo json_encode(['success' => true]);
        exit;
    }
    
    // 6. FINISH RUN
    if ($action === 'finish_run' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $runId = $input['run_id'];
        $status = $input['status']; // 'passed', 'failed'
        
        $pdo->prepare("UPDATE sys_test_runs SET overall_status = :s WHERE rec_id = :id")
            ->execute([':s'=>$status, ':id'=>$runId]);

        echo json_encode(['success' => true]);
        exit;
    }

    echo json_encode(['success' => false, 'error' => 'Unknown action']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
