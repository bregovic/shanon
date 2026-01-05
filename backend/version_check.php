<?php
header('Content-Type: application/json');
echo json_encode([
    'php_version' => phpversion(),
    'extensions' => get_loaded_extensions(),
    'openssl' => extension_loaded('openssl'),
    'curl' => extension_loaded('curl')
]);
