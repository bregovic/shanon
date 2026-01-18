<?php
// db.php - Database Connection Wrapper (PostgreSQL)

class DB {
    private static $pdo = null;

    public static function connect() {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        // 1. Zkusíme načíst konfiguraci z Railway (DATABASE_URL)
        $dbUrl = getenv('DATABASE_URL');
        
        if ($dbUrl) {
            // Parse Railway URL: postgres://user:pass@host:port/dbname
            $parts = parse_url($dbUrl);
            $host = $parts['host'];
            $port = $parts['port'] ?? 5432;
            $db   = ltrim($parts['path'], '/');
            $user = $parts['user'];
            $pass = $parts['pass'];
        } else {
            // 2. Fallback na lokální proměnné (Docker Compose)
            $host = getenv('DB_HOST') ?: 'localhost';
            $port = getenv('DB_PORT') ?: '5432';
            $db   = getenv('DB_NAME') ?: 'shanon_db';
            $user = getenv('DB_USER') ?: 'postgres';
            $pass = getenv('DB_PASS') ?: 'password';
        }

        try {
            // DSN pro PostgreSQL
            $dsn = "pgsql:host=$host;port=$port;dbname=$db";
            
            self::$pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_TIMEOUT => 5, // 5 seconds connection timeout
            ]);
            
            return self::$pdo;
        } catch (PDOException $e) {
            // V produkci nikdy nevypisovat heslo!
            error_log("DB Connection Error: " . $e->getMessage());
            http_response_code(500);
            echo json_encode(['error' => 'Database connection failed']);
            exit;
        }
    }
    
    // Helper pro transakce (důležité pro ERP)
    public static function transaction(callable $callback) {
        $pdo = self::connect();
        try {
            $pdo->beginTransaction();
            $result = $callback($pdo);
            $pdo->commit();
            return $result;
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Zjistí, zda se má pro zápis do tabulky použít ID skupiny místo ID aktuální organizace.
     * Pokud je tabulka definována v sys_org_shared_tables pro skupinu, do které organizace patří,
     * vrátí ID této skupiny. Jinak vrátí původní ID.
     */
    public static function resolveWriteOrgId($pdo, $currentOrgId, $tableName) {
        if (!$currentOrgId) return null;

        // Check if currentOrgId belongs to a group that shares this table
        $sql = "
            SELECT m.group_id 
            FROM sys_org_group_members m
            JOIN sys_org_shared_tables st ON m.group_id = st.group_id
            WHERE m.member_id = :oid 
              AND st.table_name = :tbl 
              AND st.is_active = true
            LIMIT 1
        ";
        
        $stmt = $pdo->prepare($sql);
        $stmt->execute([':oid' => $currentOrgId, ':tbl' => $tableName]);
        $groupId = $stmt->fetchColumn();
        
        return $groupId ? $groupId : $currentOrgId;
    }
}
