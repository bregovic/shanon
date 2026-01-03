<?php
// backend/ajax-logout.php
require_once 'cors.php';
require_once 'session_init.php';

session_unset();
session_destroy();

header("Content-Type: application/json");
echo json_encode(['success' => true]);
