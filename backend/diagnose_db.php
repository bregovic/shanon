<?php
require_once 'cors.php';
require_once 'db.php';

header("Content-Type: text/plain");

try {
    echo "Connecting to DB...\n";
    $pdo = DB::connect();
    echo "Connected.\n";

    // Check table
    $stmt = $pdo->query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sys_user_params'");
    $cols = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($cols)) {
        echo "Table 'sys_user_params' DOES NOT EXIST.\n";
        echo "Please ensure migration 081_sys_user_params.sql is run.\n";
        
        // Attempt simple creation (fallback)
        echo "Attempting fallback creation...\n";
        $sql = "CREATE TABLE IF NOT EXISTS sys_user_params (
            rec_id SERIAL PRIMARY KEY,
            tenant_id UUID NOT NULL,
            user_id INTEGER NOT NULL,
            param_key VARCHAR(100) NOT NULL,
            param_value JSONB,
            updated_at TIMESTAMP DEFAULT NOW(),
            org_id CHAR(5)
        )";
        $pdo->exec($sql);
        echo "Table created (fallback).\n";
        
        // Check again
        $stmt = $pdo->query("SELECT column_name FROM information_schema.columns WHERE table_name = 'sys_user_params'");
        $cols = $stmt->fetchAll(PDO::FETCH_ASSOC);
        print_r($cols);
    } else {
        echo "Table 'sys_user_params' exists.\n";
        echo "Columns:\n";
        foreach ($cols as $c) {
            echo " - {$c['column_name']} ({$c['data_type']})\n";
        }
    }

    echo "Done.\n";

} catch (Throwable $e) {
    echo "Error: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString();
}
