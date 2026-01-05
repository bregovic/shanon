<?php
// test-ocr.php
require_once 'backend/db.php';
require_once 'backend/helpers/OcrEngine.php';

header('Content-Type: text/plain');

echo "=== System Checks ===\n";
echo "PHP Version: " . phpversion() . "\n";
echo "OS: " . PHP_OS . "\n";

// Check Tesseract
$output = [];
$code = 0;
exec('tesseract --version 2>&1', $output, $code);
echo "Tesseract Check (Code $code):\n" . implode("\n", $output) . "\n\n";

// Check PDFtoText
$output = [];
$code = 0;
exec('pdftotext -v 2>&1', $output, $code);
echo "PDFtoText Check (Code $code):\n" . implode("\n", $output) . "\n\n";

// Check Database Attributes
echo "=== Database Attributes ===\n";
try {
    $pdo = DB::connect();
    $stmt = $pdo->query("SELECT * FROM dms_attributes");
    $attrs = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo "Found " . count($attrs) . " attributes.\n";
    foreach ($attrs as $a) {
        echo "- {$a['name']} (Type: {$a['data_type']}, Code: " . ($a['code'] ?? 'NULL') . ")\n";
    }

    // Check Metadata Column
    echo "\n=== DMS Schema Check ===\n";
    $stmt = $pdo->query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'dms_documents' AND column_name = 'metadata'");
    $col = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($col) {
        echo "Column 'metadata' EXISTS (Type: {$col['data_type']})\n";
    } else {
        echo "Column 'metadata' MISSING!\n";
    }

} catch (Exception $e) {
    echo "DB Error: " . $e->getMessage() . "\n";
}
