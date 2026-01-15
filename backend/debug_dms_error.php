<?php
// backend/debug_dms_error.php
// Debug script to diagnose 500 errors in DMS List
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Adjust path to db.php if needed (backend root)
require_once 'db.php';

echo "<html><body><h1>DMS Debugger</h1>";

try {
    $pdo = DB::connect();
    echo "<p style='color:green'>Database Connected</p>";

    // 1. Check Columns in dms_documents
    echo "<h2>Table Structure: dms_documents</h2>";
    $stmt = $pdo->query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'dms_documents' ORDER BY ordinal_position");
    $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (empty($columns)) {
        echo "<p style='color:red'>Table dms_documents NOT FOUND!</p>";
    } else {
        echo "<table border='1'><tr><th>Column</th><th>Type</th></tr>";
        $hasStatus = false;
        foreach ($columns as $col) {
            $style = ($col['column_name'] === 'status') ? "style='background:yellow;font-weight:bold'" : "";
            echo "<tr $style><td>{$col['column_name']}</td><td>{$col['data_type']}</td></tr>";
            if ($col['column_name'] === 'status') $hasStatus = true;
        }
        echo "</table>";
        
        if ($hasStatus) {
            echo "<p style='color:green;font-weight:bold'>Column 'status' EXISTS.</p>";
        } else {
            echo "<p style='color:red;font-weight:bold'>Column 'status' MISSING! (Migration 035 failed)</p>";
        }
    }

    // 2. Test the List Query
    echo "<h2>Testing List Query</h2>";
    $sql = "SELECT d.*, t.name as doc_type_name, u.full_name as uploaded_by_name
            FROM dms_documents d
            LEFT JOIN dms_doc_types t ON d.doc_type_id = t.rec_id
            LEFT JOIN sys_users u ON d.created_by = u.rec_id
            ORDER BY d.created_at DESC LIMIT 5";
            
    echo "<pre>$sql</pre>";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo "<p>Rows returned: " . count($data) . "</p>";
    
    // 3. Test JSON Encoding
    echo "<h2>Testing JSON Encode</h2>";
    $json = json_encode($data);
    if ($json === false) {
        echo "<p style='color:red'>JSON Encode FAILED: " . json_last_error_msg() . "</p>";
        // Find which row causes it
        foreach ($data as $i => $row) {
             if (json_encode($row) === false) {
                 echo "<p>Row $i causes error: " . json_last_error_msg() . "</p>";
                 // Check fields
                 foreach ($row as $k => $v) {
                     if (json_encode([$k=>$v]) === false) {
                         echo "Field [$k] is invalid.</p>";
                     }
                 }
             }
        }
    } else {
        echo "<p style='color:green'>JSON Encode OK. Length: " . strlen($json) . "</p>";
        echo "<textarea style='width:100%;height:200px'>" . htmlspecialchars($json) . "</textarea>";
    }

} catch (Throwable $e) {
    echo "<h2 style='color:red'>CRITICAL ERROR</h2>";
    echo "<p>" . htmlspecialchars($e->getMessage()) . "</p>";
    echo "<pre>" . htmlspecialchars($e->getTraceAsString()) . "</pre>";
}

echo "</body></html>";
