<?php
// backend/DbSessionHandler.php

class DbSessionHandler implements SessionHandlerInterface {
    private $pdo;

    public function __construct($pdo) {
        $this->pdo = $pdo;
    }

    #[\ReturnTypeWillChange]
    public function open($savePath, $sessionName) {
        return true;
    }

    #[\ReturnTypeWillChange]
    public function close() {
        return true;
    }

    #[\ReturnTypeWillChange]
    public function read($id) {
        $stmt = $this->pdo->prepare("SELECT data FROM sys_sessions WHERE id = :id");
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row) {
            return $row['data'];
        }
        return '';
    }

    #[\ReturnTypeWillChange]
    public function write($id, $data) {
        $access = time();
        // Upsert logic (PostgreSQL)
        $sql = "INSERT INTO sys_sessions (id, data, access) 
                VALUES (:id, :data, :access) 
                ON CONFLICT (id) DO UPDATE SET data = :data, access = :access";
        
        $stmt = $this->pdo->prepare($sql);
        return $stmt->execute([
            ':id' => $id,
            ':data' => $data,
            ':access' => $access
        ]);
    }

    #[\ReturnTypeWillChange]
    public function destroy($id) {
        $stmt = $this->pdo->prepare("DELETE FROM sys_sessions WHERE id = :id");
        return $stmt->execute([':id' => $id]);
    }

    #[\ReturnTypeWillChange]
    public function gc($max_lifetime) {
        $old = time() - $max_lifetime;
        $stmt = $this->pdo->prepare("DELETE FROM sys_sessions WHERE access < :old");
        $stmt->execute([':old' => $old]);
        return $stmt->rowCount();
    }
}
