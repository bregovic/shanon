<?php
// Zapnout zobrazování chyb
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "<h1>Test Preview Generation</h1>";

// 1. Zkusit připojení k DB
try {
    require_once 'db.php';
    $pdo = DB::connect();
    echo "✅ DB Connected<br>";
} catch (Throwable $e) {
    die("❌ DB Connection Failed: " . $e->getMessage());
}

$id = $_GET['id'] ?? 65;
echo "Testing Doc ID: $id<br>";

// 2. Načíst dokument
$stmt = $pdo->prepare("SELECT d.*, sp.type as storage_type, sp.configuration 
                        FROM dms_documents d
                        LEFT JOIN dms_storage_profiles sp ON d.storage_profile_id = sp.rec_id
                        WHERE d.rec_id = :id");
$stmt->execute([':id' => $id]);
$doc = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$doc) die("❌ Document not found in DB");

echo "Document Found: " . htmlspecialchars($doc['display_name']) . " (" . $doc['mime_type'] . ")<br>";
echo "Storage Type: " . ($doc['storage_type'] ?? 'local') . "<br>";
echo "Storage Path: " . $doc['storage_path'] . "<br>";

// 3. Cesta k souboru
$localPath = null;
if (($doc['storage_type'] ?? 'local') === 'google_drive') {
    echo "Attempting Google Drive Fetch...<br>";
    try {
        $gdPath = __DIR__ . '/helpers/GoogleDriveStorage.php';
        if (!file_exists($gdPath)) die("❌ GoogleDriveStorage.php not found at: $gdPath");
        
        require_once $gdPath;
        echo "✅ GoogleDriveStorage class loaded<br>";
        
        $config = json_decode($doc['configuration'] ?? '{}', true);
        if (empty($config)) die("❌ Empty Storage Configuration");
        
        $drive = new GoogleDriveStorage(json_encode($config['service_account_json']), $config['folder_id']);
        $content = $drive->downloadFile($doc['storage_path']);
        
        $ext = $doc['file_extension'] ?: 'tmp';
        $tempPath = sys_get_temp_dir() . '/' . uniqid('test_prev_') . '.' . $ext;
        file_put_contents($tempPath, $content);
        $localPath = $tempPath;
        echo "✅ File downloaded from Drive to: $localPath (" . filesize($localPath) . " bytes)<br>";
    } catch (Throwable $e) {
        die("❌ Drive Error: " . $e->getMessage());
    }
} else {
    // Local
    $localPath = __DIR__ . '/../' . $doc['storage_path'];
    if (!file_exists($localPath)) {
         $localPath = __DIR__ . '/../uploads/dms/' . basename($doc['storage_path']);
    }
    echo "Checking Local Path: $localPath<br>";
    if (!file_exists($localPath)) die("❌ File not found locally");
    echo "✅ File exists<br>";
}

// 4. Test Imagick
if ($doc['mime_type'] === 'application/pdf') {
    echo "<h2>Testing PDF Conversion</h2>";
    
    if (class_exists('Imagick')) {
        echo "✅ Imagick Class available<br>";
        try {
            $im = new Imagick();
            echo "✅ Imagick Instance created<br>";
            
            $im->setResolution(72, 72);
            $im->readImage($localPath . '[0]');
            echo "✅ Read Image OK<br>";
            
            $im->setImageFormat('jpeg');
            echo "✅ Set Format OK<br>";
            
            $blob = $im->getImageBlob();
            echo "✅ Get Blob OK (Size: " . strlen($blob) . ")<br>";
            
            $im->clear();
        } catch (Throwable $e) {
            echo "❌ Imagick Failed: " . $e->getMessage() . "<br>";
            echo "<pre>" . $e->getTraceAsString() . "</pre>";
        }
    } else {
        echo "⚠️ Imagick Class NOT available<br>";
    }
    
    // Test PDFToPPM
    echo "<h3>Testing pdftoppm</h3>";
    $out = sys_get_temp_dir() . '/' . uniqid('ppm_test_');
    $cmd = "pdftoppm -jpeg -f 1 -l 1 -singlefile " . escapeshellarg($localPath) . " " . escapeshellarg($out) . " 2>&1";
    echo "Command: $cmd<br>";
    $output = [];
    $ret = 0;
    exec($cmd, $output, $ret);
    echo "Return Code: $ret<br>";
    echo "Output: " . implode("\n", $output) . "<br>";
    
    if (file_exists($out . '.jpg')) {
        echo "✅ pdftoppm created file correctly<br>";
        unlink($out . '.jpg');
    } else {
        echo "❌ pdftoppm failed to create file<br>";
    }
}

// Cleanup
if (isset($tempPath) && file_exists($tempPath)) unlink($tempPath);
?>
