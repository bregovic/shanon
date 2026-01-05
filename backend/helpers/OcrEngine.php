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
        // Fix for local vs absolute paths
        if (!file_exists($filepath)) {
            $baseDir = dirname(__DIR__); // Assuming we are in backend/helpers, go up to backend
            $filepath = $baseDir . '/' . $filepath;
        }

        if (!file_exists($filepath)) {
            // Last resort check for uploads folder
            $filepath = dirname(__DIR__) . '/uploads/dms/' . basename($doc['storage_path']);
            if (!file_exists($filepath)) {
                throw new Exception("File not found on disk: " . $doc['storage_path']);
            }
        }

        // 3. Extract Text
        $rawText = $this->extractText($filepath, $doc['mime_type']);
        if (empty($rawText)) {
            return ['success' => false, 'message' => 'No text extracted from document'];
        }

        // 4. Update Document with raw OCR text (optional but good for search)
        // Note: For now we just return it, later we can save it

        // 5. Find Attributes
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
        // Fetch all attributes for this tenant
        // AND their translations
        $sql = "SELECT a.rec_id, a.name, a.data_type, 
                       t.translation, t.language_code
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
                    'type' => $row['data_type'],
                    'keywords' => [$row['name']] // Start with the main name
                ];
            }
            if (!empty($row['translation'])) {
                $attrMap[$id]['keywords'][] = $row['translation'];
            }
        }

        $results = [];

        // Normalize text for search (keep format but lower case for matching)
        $lines = explode("\n", $text);
        
        foreach ($attrMap as $attr) {
            $bestMatch = null;
            
            foreach ($attr['keywords'] as $keyword) {
                // Try to find this keyword in the text
                $val = $this->findValueForKeyword($lines, $keyword, $attr['type']);
                if ($val) {
                    $bestMatch = $val;
                    break; // Found a value for this attribute based on a strong keyword match
                }
            }

            if ($bestMatch) {
                $results[] = [
                    'attribute_id' => $attr['id'],
                    'attribute_name' => $attr['name'],
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
    private function findValueForKeyword($lines, $keyword, $dataType) {
        $keyLower = mb_strtolower($keyword, 'UTF-8');
        // Remove common suffixes like ":" from keyword for cleaner matching
        $keyLower = rtrim($keyLower, ':');

        foreach ($lines as $i => $line) {
            $lineLower = mb_strtolower($line, 'UTF-8');
            
            // STRATEGY 1: Same Line (KeyValue pair)
            // e.g. "Total Amount: 500 USD"
            $pos = mb_strpos($lineLower, $keyLower);
            if ($pos !== false) {
                // Check what comes AFTER the keyword
                $suffix = mb_substr($line, $pos + mb_strlen($keyLower));
                
                // Clean leading separators like : or -
                $suffix = ltrim($suffix, " \t:-");
                
                $val = $this->parseValue($suffix, $dataType);
                if ($val) {
                    return ['value' => $val, 'confidence' => 'High', 'strategy' => 'SameLine'];
                }
            }
        }

        // STRATEGY 2: Next Line (Label header)
        // e.g. "Total Amount"
        //      "500.00"
        foreach ($lines as $i => $line) {
            $lineLower = mb_strtolower($line, 'UTF-8');
            // Strict match for label line
            $cleanLine = trim($lineLower);
            $cleanLine = rtrim($cleanLine, ':');
            
            if ($cleanLine === $keyLower) {
                // Look at next line
                if (isset($lines[$i+1])) {
                    $nextLine = trim($lines[$i+1]);
                    $val = $this->parseValue($nextLine, $dataType);
                    if ($val) {
                        return ['value' => $val, 'confidence' => 'Medium', 'strategy' => 'NextLine'];
                    }
                }
            }
        }

        return null;
    }

    /**
     * Parse and validate value based on expected type
     */
    private function parseValue($rawStr, $dataType) {
        $rawStr = trim($rawStr);
        if (empty($rawStr)) return null;

        if ($dataType === 'number') {
            // Look for numbers. Common formats: 1,000.00 or 1.000,00
            // Naive approach: remove everything except digits, dots, commas
            if (preg_match('/[\d\.,]+/', $rawStr, $matches)) {
                return $matches[0]; 
            }
        }

        if ($dataType === 'date') {
            // Looking for date patterns
            // DD.MM.YYYY
            if (preg_match('/\d{1,2}\.\s*\d{1,2}\.\s*\d{4}/', $rawStr, $matches)) {
                return $matches[0];
            }
            // YYYY-MM-DD
            if (preg_match('/\d{4}-\d{2}-\d{2}/', $rawStr, $matches)) {
                return $matches[0];
            }
        }

        if ($dataType === 'text') {
            // For text, we usually want to avoid picking up garbage
            // Example strictness: must be > 1 chars
            if (strlen($rawStr) > 1) return $rawStr;
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
            // Try pdftotext first (faster, better for digital PDFs)
            $cmd = "pdftotext -layout " . escapeshellarg($filepath) . " -";
            $output = [];
            $code = 0;
            exec($cmd, $output, $code);
            
            if ($code === 0 && !empty($output)) {
                $text = implode("\n", $output);
            }

            // If text is empty/too short, it might be a scanned PDF -> Use Tesseract
            if (strlen(trim($text)) < 50) {
                // Need to convert PDF to image first for Tesseract usually, 
                // OR use advanced tools like 'ocrmypdf'.
                // Ideally, pure tesseract doesn't read PDF directly without config.
                // For simplicity in this PHP env, we might rely on the user mainly uploading images or readable pdfs.
                // But let's verify if 'pdftoppm' exists (from poppler-utils) to convert to image.
                
                // Converting PDF to temporary TIFF for Tesseract
                $tempTiff = sys_get_temp_dir() . '/' . uniqid('ocr_') . '.tiff';
                // cmd: gs -sDEVICE=tiffg4 -o output.tiff input.pdf (needs ghostscript)
                // simplifying: assume if pdftotext failed, it's hard. 
                // Let's force an error or message for now to not overcomplicate the shell deps.
                if (strlen(trim($text)) < 10) {
                     $text .= "\n[WARN: PDF appears to be scanned. Converting to image for OCR requires additional tools.]";
                }
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
