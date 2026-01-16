<?php
// backend/helpers/DataSeeder.php

class DataSeeder {
    private $pdo;
    private $tenantId;
    private $orgId;

    public function __construct($pdo, $tenantId, $orgId) {
        $this->pdo = $pdo;
        $this->tenantId = $tenantId;
        $this->orgId = $orgId;
    }

    /**
     * Returns list of available seeders for UI
     */
    public function getAvailableSeeders() {
        return [
            [
                'id' => 'dms_types',
                'name' => 'DMS: Typy dokumentů',
                'description' => 'Základní typy: Faktura, Smlouva, Obecný dokument...'
            ],
            [
                'id' => 'dms_series',
                'name' => 'DMS: Číselné řady',
                'description' => 'Výchozí řady: DOC, FAK, SMV'
            ],
            [
                'id' => 'dms_storage',
                'name' => 'DMS: Lokální úložiště',
                'description' => 'Výchozí profil pro lokální ukládání souborů'
            ]
        ];
    }

    public function run($seederIds) {
        $results = [];
        foreach ($seederIds as $id) {
            try {
                $method = 'seed' . str_replace('_', '', ucwords($id, '_')); // dms_types -> seedDmsTypes
                if (method_exists($this, $method)) {
                    $count = $this->$method();
                    $results[$id] = ['success' => true, 'message' => "Vloženo/aktualizováno $count záznamů."];
                } else {
                    $results[$id] = ['success' => false, 'error' => "Method $method not found."];
                }
            } catch (Exception $e) {
                $results[$id] = ['success' => false, 'error' => $e->getMessage()];
            }
        }
        return $results;
    }

    // --- SEEDERS ---

    private function seedDmsTypes() {
        $data = [
            ['GEN', 'Obecný dokument', 'Gen.', 'Document24Regular'],
            ['INV_IN', 'Faktura přijatá', 'Fak.', 'Receipt24Regular'],
            ['CON', 'Smlouva', 'Sml.', 'Signature24Regular']
        ];

        $count = 0;
        $sql = "INSERT INTO dms_doc_types (tenant_id, org_id, code, name, description, icon, is_active) 
                VALUES (:tid, :oid, :code, :name, :desc, :icon, true)
                ON CONFLICT (tenant_id, org_id, code) DO NOTHING"; // Requires the unique index we added earlier

        $stmt = $this->pdo->prepare($sql);

        foreach ($data as $row) {
            $stmt->execute([
                ':tid' => $this->tenantId,
                ':oid' => $this->orgId,
                ':code' => $row[0],
                ':name' => $row[1],
                ':desc' => $row[2],
                ':icon' => $row[3]
            ]);
            if ($stmt->rowCount() > 0) $count++;
        }
        return $count;
    }

    private function seedDmsSeries() {
        $data = [
            ['DOC', 'Obecné dokumenty', 'DOC-', 5, true],
            ['FAK', 'Faktury přijaté', 'FAK-', 6, false],
            ['SMV', 'Smlouvy', 'SMV-', 4, false]
        ];

        $count = 0;
        $sql = "INSERT INTO dms_number_series (tenant_id, org_id, code, name, prefix, number_length, is_default, is_active) 
                VALUES (:tid, :oid, :code, :name, :pref, :len, :def, true)
                ON CONFLICT (tenant_id, org_id, code) DO NOTHING";
        
        $stmt = $this->pdo->prepare($sql);

        foreach ($data as $row) {
             // Only set is_default=true if no other default exists? 
             // For now, simple insert.
             $stmt->execute([
                 ':tid' => $this->tenantId,
                 ':oid' => $this->orgId,
                 ':code' => $row[0],
                 ':name' => $row[1],
                 ':pref' => $row[2],
                 ':len' => $row[3],
                 ':def' => $row[4] ? 'true' : 'false'
             ]);
             if ($stmt->rowCount() > 0) $count++;
        }
        return $count;
    }

    private function seedDmsStorage() {
        // Only insert if NO active profile exists for this org
        $check = $this->pdo->prepare("SELECT 1 FROM dms_storage_profiles WHERE tenant_id = ? AND org_id = ? AND is_active = true");
        $check->execute([$this->tenantId, $this->orgId]);
        if ($check->fetch()) return 0; // Already setup

        $sql = "INSERT INTO dms_storage_profiles (tenant_id, org_id, name, type, configuration, base_path, is_active, is_default)
                VALUES (:tid, :oid, 'Lokální úložiště (Default)', 'local', '{}', 'uploads/', true, true)";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':tid' => $this->tenantId, ':oid' => $this->orgId]);
        return $stmt->rowCount();
    }
}
