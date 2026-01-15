<?php
// backend/debug_full.php
error_reporting(E_ALL);
ini_set('display_errors', 1);

echo "Step 1: Starting...<br>";

try {
    echo "Step 2: Require cors.php... ";
    require_once 'cors.php';
    echo "OK<br>";

    // Manual DB test
    echo "Step 3: Require db.php... ";
    require_once 'db.php';
    echo "OK<br>";
    
    // Check DB connection
    $pdo = DB::connect();
    echo "DB Connected.<br>";

    // Manual Session Handler loading
    echo "Step 4: Require DbSessionHandler.php... ";
    require_once 'DbSessionHandler.php';
    echo "OK<br>";
    
    // Instantiate Handler
    echo "Step 5: Instantiate DbSessionHandler... ";
    $handler = new DbSessionHandler($pdo);
    echo "OK<br>";

    // Require Session Init
    echo "Step 6: Require session_init.php... ";
    // session_init attempts to start session, might fail if headers sent?
    // We already sent output, so session_start might warn "headers already sent".
    // But we want to check for FATAL errors.
    require_once 'session_init.php'; 
    echo "OK (Session started or warned)<br>";

    // Require OCR Engine
    echo "Step 7: Require helpers/OcrEngine.php... ";
    require_once 'helpers/OcrEngine.php';
    echo "OK<br>";
    
    echo "Step 8: Instantiate OCR Engine... ";
    $ocr = new OcrEngine($pdo, 'uuid-placeholder');
    echo "OK<br>";

    echo "<h1>ALL SYSTEMS GO</h1>";
    echo "PHP Version: " . phpversion();

} catch (Throwable $e) {
    echo "<h1 style='color:red'>CRITICAL FAILURE</h1>";
    echo "Message: " . $e->getMessage() . "<br>";
    echo "File: " . $e->getFile() . "<br>";
    echo "Line: " . $e->getLine() . "<br>";
    echo "<pre>" . $e->getTraceAsString() . "</pre>";
}
