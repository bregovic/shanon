<?php
// backend/api-translations.php
// Simple translation loader from JSON files

require_once 'cors.php';

header("Content-Type: application/json");

$lang = $_GET['lang'] ?? 'cs';
if (!in_array($lang, ['cs', 'en'])) {
    $lang = 'cs';
}

$jsonFile = __DIR__ . '/translations/' . $lang . '.json';

if (file_exists($jsonFile)) {
    $content = file_get_contents($jsonFile);
    $translations = json_decode($content, true);
    
    if ($translations !== null) {
        echo json_encode([
            'success' => true,
            'lang' => $lang,
            'translations' => $translations
        ]);
    } else {
        echo json_encode([
            'success' => false,
            'message' => 'Invalid JSON format'
        ]);
    }
} else {
    echo json_encode([
        'success' => false,
        'message' => 'Translation file not found: ' . $lang
    ]);
}
