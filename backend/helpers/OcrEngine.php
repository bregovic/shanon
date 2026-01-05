<?php
// backend/helpers/OcrEngine.php

class OcrEngine {
    private $pdo;
    private $tenantId;

    public function __construct($pdo, $tenantId) {
        $this->pdo = $pdo;
        $this->tenantId = $tenantId;
    }

    /**
     * Main entry point: Analyze a document and return found attributes
     */
    public function analyzeDocument($docId) {
        // 1. Get Document Info
        $stmt = $this->pdo->prepare("SELECT * FROM dms_documents WHERE rec_id = :id");
        $stmt->execute([':id' => $docId]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) throw new Exception("Document not found");

        // 2. Resolve File Path
        $filepath = $doc['storage_path'];
        if (!file_exists($filepath)) {
            $baseDir = dirname(__DIR__);
            $filepath = $baseDir . '/' . $filepath;
        }

        if (!file_exists($filepath)) {
            $filepath = dirname(__DIR__) . '/uploads/dms/' . basename($doc['storage_path']);
            if (!file_exists($filepath)) {
                // If file is missing on disk, try to recover from DB blob if needed (not implemented here for OCR yet)
                throw new Exception("File not found on disk: " . $doc['storage_path']);
            }
        }

        // 3. Extract Text
        $rawText = $this->extractText($filepath, $doc['mime_type']);
        if (empty($rawText)) {
            return ['success' => false, 'message' => 'No text extracted from document'];
        }

        // 4. Find Attributes
        $foundAttributes = $this->extractAttributes($rawText);

        return [
            'success' => true,
            'doc_id' => $docId,
            'raw_text_preview' => substr($rawText, 0, 500) . '...',
            'attributes' => $foundAttributes
        ];
    }

    /**
     * Smart Extraction Logic
     */
    private function extractAttributes($text) {
        // Fetch all attributes for this tenant (include CODE)
        $sql = "SELECT a.rec_id, a.name, a.code, a.data_type, 
                       t.translation
                FROM dms_attributes a
                LEFT JOIN sys_translations t 
                       ON t.table_name = 'dms_attributes' 
                       AND t.record_id = a.rec_id 
                       AND t.field_name = 'name'
                WHERE a.tenant_id = :tid OR a.tenant_id IS NULL";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':tid' => $this->tenantId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Group by Attribute
        $attrMap = [];
        foreach ($rows as $row) {
            $id = $row['rec_id'];
            if (!isset($attrMap[$id])) {
                $attrMap[$id] = [
                    'id' => $id,
                    'name' => $row['name'],
                    'code' => $row['code'], // Ensure CODE is used for smart matching
                    'type' => $row['data_type'],
                    'keywords' => [$row['name']]
                ];
            }
            if (!empty($row['translation'])) {
                $attrMap[$id]['keywords'][] = $row['translation'];
            }
        }

        $results = [];

        // Normalize text
        $lines = explode("\n", $text);
        
        foreach ($attrMap as $attr) {
            $bestMatch = null;
            
            foreach ($attr['keywords'] as $keyword) {
                // Try to find this keyword in the text
                $val = $this->findValueForKeyword($lines, $keyword, $attr['type'], $attr['code']);
                if ($val) {
                    $bestMatch = $val;
                    break;
                }
            }

            if ($bestMatch) {
                $results[] = [
                    'attribute_id' => $attr['id'],
                    'attribute_name' => $attr['name'], // Keeping name for compatibility, ideally use code
                    'attribute_code' => $attr['code'],
                    'found_value' => $bestMatch['value'],
                    'confidence' => $bestMatch['confidence'],
                    'strategy' => $bestMatch['strategy']
                ];
            }
        }

        return $results;
    }

    /**
     * Search strategies
     */
    private function findValueForKeyword($lines, $keyword, $dataType, $code = null) {
        $keyLower = mb_strtolower($keyword, 'UTF-8');
        $keyLower = rtrim($keyLower, ':');

        foreach ($lines as $i => $line) {
            $lineLower = mb_strtolower($line, 'UTF-8');
            
            // Match Keyword
            $pos = mb_strpos($lineLower, $keyLower);
            if ($pos !== false) {
                // Potential candidates: 
                // 1. Same line (suffix)
                // 2. Next line (if same line is empty or just label)
                
                $suffix = mb_substr($line, $pos + mb_strlen($keyLower));
                $suffix = ltrim($suffix, " \t:-");

                // --- SMART LOGIC BASED ON CODE ---

                // 1. IBAN / Bank Account
                if ($code === 'BANK_ACCOUNT' || $code === 'IBAN') {
                    // Try to find regex in Suffix
                    if (preg_match('/CZ\d{22}/', $suffix, $m)) return ['value' => $m[0], 'confidence' => 'High', 'strategy' => 'IBAN_Regex'];
                    // Try next line if not found
                    if (isset($lines[$i+1]) && preg_match('/CZ\d{22}/', $lines[$i+1], $m)) {
                        return ['value' => $m[0], 'confidence' => 'High', 'strategy' => 'IBAN_Regex_NextLine'];
                    }
                }

                // 2. ICO / ID Number (8 digits)
                if (strpos($code, 'ICO') !== false || $code === 'SUPPLIER_ID') {
                     if (preg_match('/\b\d{8}\b/', $suffix, $m)) return ['value' => $m[0], 'confidence' => 'High', 'strategy' => 'ICO_Regex'];
                     if (isset($lines[$i+1]) && preg_match('/\b\d{8}\b/', $lines[$i+1], $m)) {
                        return ['value' => $m[0], 'confidence' => 'High', 'strategy' => 'ICO_Regex_NextLine'];
                     }
                }

                // --- GENERIC TYPE LOGIC ---
                
                // Strategy A: Same Line
                $val = $this->parseValue($suffix, $dataType, $code);
                if ($val) return ['value' => $val, 'confidence' => 'High', 'strategy' => 'SameLine'];

                // Strategy B: Next Line
                if (isset($lines[$i+1])) {
                    $nextLine = trim($lines[$i+1]);
                    // Avoid taking next line if it looks like a label (ends with :)
                    if (!preg_match('/:$/', $nextLine)) {
                         $val = $this->parseValue($nextLine, $dataType, $code);
                         if ($val) return ['value' => $val, 'confidence' => 'Medium', 'strategy' => 'NextLine'];
                    }
                }
            }
        }
        return null;
    }

    /**
     * Parse and validate value
     */
    private function parseValue($rawStr, $dataType, $code = null) {
        $rawStr = trim($rawStr);
        if (empty($rawStr)) return null;

        // Clean up common "noise" from OCR (e.g. pipe chars, random dots at start)
        $rawStr = ltrim($rawStr, '|._-');

        // Stop at common label delimiters if "SameLine" grabbed too much
        // e.g. "12345 Datum splatnosti:" -> we want just "12345"
        // Heuristic: Split by double space or common keywords
        $stopWords = ['datum', 'splatnosti', 'vystavení', 'duzp', 'ičo', 'dič', 'tel', 'email'];
        $words = preg_split('/\s+/', $rawStr);
        $cleanParts = [];
        foreach ($words as $w) {
            if (in_array(mb_strtolower($w, 'UTF-8'), $stopWords)) break;
            $cleanParts[] = $w;
        }
        // Reassemble, but careful. If we stripped everything, fallback to original?
        // Actually for Date/Number we extract specifically. For text we accept the cut.
        $candidate = implode(' ', $cleanParts);


        if ($dataType === 'number') {
            // Money or Counts
            // Remove spaces, handle comma/dot
            // Example: "1 234,50" -> 1234.50
            // Example: "1.234,50" -> 1234.50
            // Regex to find the number part:
            if (preg_match('/[\d\s\.,]+/', $rawStr, $matches)) {
                $numStr = $matches[0];
                // Replace spaces
                $numStr = str_replace(' ', '', $numStr);
                // Replace comma with dot if it looks like decimal separator
                $numStr = str_replace(',', '.', $numStr);
                // Handle multiple dots? "1.000.00" -> this simple logic fails. 
                // Simple parse: keep only digits and last dot/comma
                return floatval($numStr); // Simplified for MVP
            }
        }

        if ($dataType === 'date') {
            // DD.MM.YYYY or DD. MM. YYYY
            if (preg_match('/\d{1,2}\.\s*\d{1,2}\.\s*\d{4}/', $rawStr, $matches)) {
                return $matches[0];
            }
            // YYYY-MM-DD
            if (preg_match('/\d{4}-\d{2}-\d{2}/', $rawStr, $matches)) {
                return $matches[0];
            }
        }

        if ($dataType === 'text') {
            // Normalize spaces
            $candidate = preg_replace('/\s+/', ' ', $candidate);
            if (strlen($candidate) > 1) return $candidate;
        }

        return null;
    }


    /**
     * Wrapper for shell commands
     */
    private function extractText($filepath, $mimeType) {
        $text = "";
        
        // 1. PDF
        if ($mimeType === 'application/pdf') {
            $cmd = "pdftotext -layout " . escapeshellarg($filepath) . " -";
            $output = [];
            $code = 0;
            exec($cmd, $output, $code);
            
            if ($code === 0 && !empty($output)) {
                $text = implode("\n", $output);
            }

            // Fallback for scanned PDF (if text is too short)
            if (strlen(trim($text)) < 50) {
                 // Try tesseract on PDF directly? 
                 // Tesseract 5 can handle PDF if configured, but normally needs image conversion.
                 // We will skip complex conversion in this script for now to avoid dependency hell.
                 // Recommend User scans with OCR enabled or we add pdftoppm later.
            }
        }
        // 2. Images
        else if (strpos($mimeType, 'image/') === 0) {
            // Make sure tesseract is callable
            // Result is stored in stdout
            $cmd = "tesseract " . escapeshellarg($filepath) . " stdout -l ces+eng";
            $output = [];
            $code = 0;
            exec($cmd, $output, $code);
            if ($code === 0) {
                $text = implode("\n", $output);
            }
        }

        return $text;
    }
}
