<?php
// backend/api-help.php

require_once 'cors.php';
require_once 'session_init.php';
require_once 'db.php';

header('Content-Type: application/json');

/*
    Publicly accessible for authenticated users.
    Read-only for normal users, Admin might eventually edit (not implemented yet).
*/

if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

$action = $_GET['action'] ?? 'search';
$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = DB::connect();

    if ($action === 'get') {
        $key = $_GET['key'] ?? '';
        if (!$key) throw new Exception("Missing key");

        $stmt = $pdo->prepare("SELECT * FROM sys_help_pages WHERE topic_key = ?");
        $stmt->execute([$key]);
        $page = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($page) {
            echo json_encode(['success' => true, 'data' => $page]);
        } else {
             // Fallback: If not found in DB, we could look for a static file, or just return empty
             // For now, return standard 404-ish
             echo json_encode(['success' => false, 'error' => 'Topic not found']);
        }

    } elseif ($action === 'search') {
        $q = $_GET['q'] ?? '';
        $module = $_GET['module'] ?? '';

        $sql = "SELECT id, topic_key, title, module FROM sys_help_pages WHERE 1=1";
        $params = [];

        if ($module) {
            $sql .= " AND (module = ? OR module = 'general')";
            $params[] = $module;
        }

        if ($q) {
            $sql .= " AND (title ILIKE ? OR keywords ILIKE ? OR content ILIKE ?)";
            $term = "%$q%";
            $params[] = $term;
            $params[] = $term;
            $params[] = $term;
        }
        
        $sql .= " ORDER BY module ASC, title ASC LIMIT 20";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'data' => $rows]);
    } elseif ($action === 'seed') {
        // Internal helper to seed generic help if empty
        // Only accessible by admin/dev theoretically, but safe enough here
        
        $count = $pdo->query("SELECT COUNT(*) FROM sys_help_pages")->fetchColumn();
        if ($count == 0) {
            $defaultHelp = [
                [
                    'topic_key' => 'general_filtering',
                    'title' => 'Filtrování a Řazení',
                    'module' => 'general',
                    'keywords' => 'grid, tabulka, filter, sort, řazení, vyhledávání',
                    'content' => "# Filtrování a Řazení dat\n\nVětšina tabulek v systému podporuje pokročilé filtrování a řazení.\n\n## Řazení\nKliknutím na záhlaví sloupce se data seřadí vzestupně. Opětovným kliknutím sestupně.\n\n## Filtrování\nPod záhlavím tabulky se zpravidla nachází filtrovací řádek.\n- Zadejte text pro vyhledávání (obsahuje).\n- Pro číselné hodnoty lze používat operátory jako `>100`, `<500`.\n- Pro datum lze zadat `2024`.\n\n## Hvězdička (Favorites)\nU položek v menu můžete kliknout na hvězdičku pro přidání do Rychlého přístupu."
                ],
                [
                    'topic_key' => 'dms_intro',
                    'title' => 'Úvod do DMS',
                    'module' => 'dms',
                    'keywords' => 'dokumenty, upload, ocr, revize',
                    'content' => "# Document Management System (DMS)\n\nDMS slouží k archivaci, vyhledávání a vytěžování dat z dokumentů.\n\n## Hlavní funkce:\n1. **Import**: Nahrání souborů (PDF, obr) přetažením.\n2. **OCR**: Automatické čtení textu.\n3. **Revize**: Kontrola vytěžených dat.\n4. **Schválení**: Finalizace dokumentu."
                ],
                [
                    'topic_key' => 'api_keys',
                    'title' => 'API Klíče a Integrace',
                    'module' => 'system',
                    'keywords' => 'google, api, token, oauth',
                    'content' => "# Nastavení Integrací\n\nPro správnou funkci propojení s Google Drive nebo jinými službami je nutné nastavit API klíče v sekci **Systém > Nastavení**.\n\n- Odkaz na generátor tokenů naleznete v detailu Google nastavení."
                ]
            ];

            $stmt = $pdo->prepare("INSERT INTO sys_help_pages (topic_key, title, module, keywords, content) VALUES (:key, :title, :mod, :kw, :content)");
            foreach ($defaultHelp as $h) {
                $stmt->execute([
                    ':key' => $h['topic_key'],
                    ':title' => $h['title'],
                    ':mod' => $h['module'],
                    ':kw' => $h['keywords'],
                    ':content' => $h['content']
                ]);
            }
            echo json_encode(['success' => true, 'seeded' => true]);
        } else {
             echo json_encode(['success' => true, 'seeded' => false]);
        }
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
