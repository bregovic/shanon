<?php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

require_once 'backend/db.php'; // Adjust path if needed

$docId = $_GET['id'] ?? 65; // User's ID from screenshot

echo "<h1>Debug Preview for Doc ID: $docId</h1>";

// 1. Fetch Doc
$stmt = $pdo->prepare("SELECT d.*, sp.type as storage_type, sp.configuration 
                       FROM dms_documents d
                       LEFT JOIN dms_storage_profiles sp ON d.storage_profile_id = sp.rec_id
                       WHERE d.rec_id = :id");
$stmt->execute([':id' => $docId]);
$doc = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$doc) die("Document not found in DB.");

echo "<pre>";
print_r($doc);
echo "</pre>";

// 2. Resolve Path
$localPath = null;
if (($doc['storage_type'] ?? 'local') === 'google_drive') {
    echo "Storage: Google Drive<br>";
    // Mock Config for path check ??
    // We can't easily test GD download here without full setup, but let's check class existence
    if (file_exists('backend/helpers/GoogleDriveStorage.php')) {
        echo "GoogleDriveStorage.php found.<br>";
    } else {
        echo "ERROR: GoogleDriveStorage.php missing.<br>";
    }
} else {
    echo "Storage: Local<br>";
    $localPath = __DIR__ . '/backend/../' . $doc['storage_path'];
    if (!file_exists($localPath)) {
         $localPath = __DIR__ . '/backend/../uploads/dms/' . basename($doc['storage_path']);
    }
    echo "Resolved Path: $localPath<br>";
    echo "File Exists: " . (file_exists($localPath) ? 'YES' : 'NO') . "<br>";
}

// 3. Test Converters
echo "<h2>Converter Availability</h2>";
echo "Imagick extension: " . (extension_loaded('imagick') ? 'LOADED' : 'NOT LOADED') . "<br>";
if (class_exists('Imagick')) {
    echo "Imagick Class: EXISTS<br>";
} else {
    echo "Imagick Class: MISSING<br>";
}

echo "Shell Exec Enabled: " . (function_exists('exec') ? 'YES' : 'NO') . "<br>";

$out = [];
$ret = 0;
exec('pdftoppm -v 2>&1', $out, $ret);
echo "pdftoppm version check: Return $ret <br>";
echo "<pre>" . implode("\n", $out) . "</pre>";

$out = [];
$ret = 0;
exec('convert -version 2>&1', $out, $ret);
echo "ImageMagick CLI check: Return $ret <br>";
echo "<pre>" . implode("\n", $out) . "</pre>";
