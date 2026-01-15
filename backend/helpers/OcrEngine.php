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
        $stmt = $this->pdo->prepare("SELECT d.*, sp.type as storage_type, sp.configuration 
                                     FROM dms_documents d
                                     LEFT JOIN dms_storage_profiles sp ON d.storage_profile_id = sp.rec_id
                                     WHERE d.rec_id = :id");
        $stmt->execute([':id' => $docId]);
        $doc = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$doc) throw new Exception("Document not found");

        // 2. Resolve File Path (Local or Drive)
        $tempPath = null;
        $localPath = null;
        $isTemp = false;

        if (($doc['storage_type'] ?? 'local') === 'google_drive') {
            require_once __DIR__ . '/GoogleDriveStorage.php';
            $config = json_decode($doc['configuration'] ?? '{}', true);
            $drive = new GoogleDriveStorage(json_encode($config['service_account_json']), $config['folder_id']);
            $content = $drive->downloadFile($doc['storage_path']);
            
            $ext = $doc['file_extension'] ?: 'tmp';
            $tempPath = sys_get_temp_dir() . '/' . uniqid('ocr_main_') . '.' . $ext;
            file_put_contents($tempPath, $content);
            $localPath = $tempPath;
            $isTemp = true;
        } else {
            // Local fallback logic
            $baseDir = dirname(__DIR__); // backend/
            $candidates = [
                 $baseDir . '/../' . $doc['storage_path'],
                 $baseDir . '/../uploads/dms/' . basename($doc['storage_path'])
            ];
            foreach($candidates as $p) {
                if (file_exists($p)) { $localPath = $p; break; }
            }
        }
        
        if (!$localPath || !file_exists($localPath)) {
             throw new Exception("File content unavailable for OCR");
        }

        // 3. Extract Full Text (Context)
        $rawText = $this->extractText($localPath, $doc['mime_type']);
        
        // 4. Try Template Matching FIRST
        $templateResults = $this->applyTemplates($doc, $localPath, $rawText);
        
        if (!empty($templateResults)) {
             $foundAttributes = $templateResults;
             $strategy = 'Template';
        } else {
             // 5. Fallback: Smart Attribute Search (Regex)
             $foundAttributes = $this->extractAttributes($rawText);
             $strategy = 'Regex';
        }

        // Cleanup
        if ($isTemp && file_exists($localPath)) {
            unlink($localPath);
        }

        return [
            'success' => true,
            'doc_id' => $docId,
            'raw_text_preview' => substr($rawText, 0, 500) . '...',
            'strategy_used' => $strategy,
            'attributes' => $foundAttributes
        ];
    }

    /**
     * Try to find a matching template and extract zones
     */
    private function applyTemplates($doc, $filePath, $fullText) {
        // Find templates for this Doc Type
        $sql = "SELECT * FROM dms_ocr_templates WHERE doc_type_id = :dt OR doc_type_id IS NULL";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([':dt' => $doc['doc_type_id']]);
        $templates = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($templates as $tpl) {
            // Check Anchor
            if (!empty($tpl['anchor_text'])) {
                 if (mb_stripos($fullText, $tpl['anchor_text']) === false) {
                     continue; // Anchor not found
                 }
            }
            
            // Match found! Process zones
            return $this->processTemplateZones($tpl['rec_id'], $filePath, $doc['mime_type']);
        }
        
        return [];
    }

    /**
     * Process all zones for a specific template against the file
     */
    private function processTemplateZones($templateId, $filePath, $mimeType) {
        $stmt = $this->pdo->prepare("SELECT * FROM dms_ocr_template_zones WHERE template_id = :tid");
        $stmt->execute([':tid' => $templateId]);
        $zones = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Prepare Image for Cropping (Once)
        $imagePath = $this->prepareImageForCropping($filePath, $mimeType);
        if (!$imagePath) return [];

        $results = [];
        foreach ($zones as $zone) {
            $val = $this->extractFromZone($imagePath, $zone);
            if ($val) {
                $results[] = [
                    'attribute_code' => $zone['attribute_code'],
                    'found_value' => $val,
                    'confidence' => 'High',
                    'strategy' => 'TemplateZone',
                    'rect' => [
                        'x' => (float)$zone['x'],
                        'y' => (float)$zone['y'],
                        'w' => (float)$zone['width'],
                        'h' => (float)$zone['height']
                    ]
                ];
            }
        }

        // Cleanup temp cropper image
        if ($imagePath && $imagePath !== $filePath && file_exists($imagePath)) {
            unlink($imagePath);
        }

        return $results;
    }

    private function prepareImageForCropping($filePath, $mimeType) {
        if (strpos($mimeType, 'image/') === 0) return $filePath;
        
        if ($mimeType === 'application/pdf') {
             $tempImg = sys_get_temp_dir() . '/' . uniqid('crop_base_') . '.jpg';
             // Try pdftoppm
             $cmd = "pdftoppm -jpeg -f 1 -l 1 -singlefile " . escapeshellarg($filePath) . " " . escapeshellarg(str_replace('.jpg','',$tempImg));
             exec($cmd);
             if (file_exists($tempImg)) return $tempImg;
             
             // Try Imagick
             if (class_exists('Imagick')) {
                 try {
                     $im = new Imagick();
                     $im->setResolution(300, 300);
                     $im->readImage($filePath . '[0]');
                     $im->setImageFormat('jpeg');
                     $im->writeImage($tempImg);
                     $im->clear();
                     return $tempImg;
                 } catch(Exception $e) {}
             }
        }
        return null;
    }

    private function extractFromZone($imagePath, $zone) {
        $info = @getimagesize($imagePath);
        if (!$info) return null;
        
        $srcW = $info[0];
        $srcH = $info[1];
        $type = $info[2];

        $cropX = floor($zone['x'] * $srcW);
        $cropY = floor($zone['y'] * $srcH);
        $cropW = floor($zone['width'] * $srcW);
        $cropH = floor($zone['height'] * $srcH);

        if ($cropW < 1) $cropW = 1; if ($cropH < 1) $cropH = 1;

        $srcImg = null;
        switch ($type) {
            case IMAGETYPE_JPEG: $srcImg = imagecreatefromjpeg($imagePath); break;
            case IMAGETYPE_PNG: $srcImg = imagecreatefrompng($imagePath); break;
            case IMAGETYPE_GIF: $srcImg = imagecreatefromgif($imagePath); break;
        }
        if (!$srcImg) return null;

        $destImg = imagecreatetruecolor($cropW, $cropH);
        imagecopy($destImg, $srcImg, 0, 0, $cropX, $cropY, $cropW, $cropH);
        
        $cropFile = sys_get_temp_dir() . '/' . uniqid('zone_') . '.jpg';
        imagejpeg($destImg, $cropFile, 90);
        imagedestroy($srcImg);
        imagedestroy($destImg);

        // Run Tesseract
        $cmd = "tesseract " . escapeshellarg($cropFile) . " stdout -l ces+eng --psm 6";
        $output = [];
        exec($cmd, $output);
        $text = trim(implode("\n", $output));
        
        if (file_exists($cropFile)) unlink($cropFile);
        
        // Parse Value
        if ($zone['regex_pattern']) {
             if (preg_match($zone['regex_pattern'], $text, $m)) return $m[0];
        }
        
        // Basic Type Parsing
        if ($zone['data_type'] === 'number') return $this->parseValue($text, 'number');
        if ($zone['data_type'] === 'date') return $this->parseValue($text, 'date');
        
        return $text;
    }

    /**
     * Smart Extraction Logic (Regex Fallback)
     */
    private function extractAttributes($text) {
        // ... (Keep existing implementation) ...
        // Fetch all attributes for this tenant (include CODE)
        $sql = "SELECT a.rec_id, a.name, a.code, a.data_type, a.scan_direction,
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
                    'scan_direction' => $row['scan_direction'] ?? 'auto',
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
                $val = $this->findValueForKeyword($lines, $keyword, $attr['type'], $attr['code'], $attr['scan_direction']);
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
    private function findValueForKeyword($lines, $keyword, $dataType, $code = null, $scanDirection = 'auto') {
        $keyLower = mb_strtolower($keyword, 'UTF-8');
        $keyLower = rtrim($keyLower, ':');

        // SPECIAL GLOBAL SEARCHES (don't rely on specific keyword position for some types)
        if ($code === 'CURRENCY') {
            // Scan whole text for currency symbols
            foreach ($lines as $line) {
                if (preg_match('/\b(CZK|EUR|USD|Kč)\b/i', $line, $m)) {
                    $curr = strtoupper($m[1]);
                    if ($curr === 'KČ') $curr = 'CZK';
                    return ['value' => $curr, 'confidence' => 'High', 'strategy' => 'GlobalCurrencyRegex'];
                }
            }
        }

        foreach ($lines as $i => $line) {
            $lineLower = mb_strtolower($line, 'UTF-8');
            
            // EXCLUSION for Supplier Attributes:
            // Ignore lines that clearly belong to the Buyer (Odběratel/Příjemce) logic avoids mixing IČO.
            $isSupplierAttr = (strpos($code ?? '', 'SUPPLIER_') !== false || $code === 'IBAN' || $code === 'BANK_ACCOUNT');
            if ($isSupplierAttr) {
                if (mb_stripos($line, 'Odběratel') !== false || mb_stripos($line, 'Příjemce') !== false) {
                    continue; 
                }
            }

            // Match Keyword
            $pos = mb_strpos($lineLower, $keyLower);
            if ($pos !== false) {
                $suffix = mb_substr($line, $pos + mb_strlen($keyLower));
                $suffix = ltrim($suffix, " \t:-");

                // --- SMART LOGIC BASED ON CODE ---
                
                // INVOICE NUMBER - Priority check
                if ($code === 'INVOICE_NUMBER') {
                    // Avoid picking up Deposit/Order numbers
                    if (mb_stripos($line, 'záloha') !== false || mb_stripos($line, 'objednávka') !== false) continue;
                    
                    // Regex search on suffix
                    if (preg_match('/(?:č\.?|číslo)?\s*:?\s*(\d{6,15})/iu', $suffix, $m)) {
                         return ['value' => $m[1], 'confidence' => 'High', 'strategy' => 'Invoice_Num_Regex'];
                    }
                }

                // 1. IBAN / Bank Account
                if ($code === 'BANK_ACCOUNT' || $code === 'IBAN') {
                    if (preg_match('/CZ(?:\s*\d){22}/', $suffix, $m)) {
                         $clean = str_replace(' ', '', $m[0]);
                         return ['value' => $clean, 'confidence' => 'High', 'strategy' => 'IBAN_Regex_Spaces'];
                    }
                    if (isset($lines[$i+1]) && preg_match('/CZ(?:\s*\d){22}/', $lines[$i+1], $m)) {
                         $clean = str_replace(' ', '', $m[0]);
                         return ['value' => $clean, 'confidence' => 'High', 'strategy' => 'IBAN_Regex_NextLine'];
                    }
                }

                // 2. ICO / ID Number (8 digits)
                if (strpos($code, 'ICO') !== false || $code === 'SUPPLIER_ICO') {
                     if (preg_match('/\b\d{8}\b/', $suffix, $m)) return ['value' => $m[0], 'confidence' => 'High', 'strategy' => 'ICO_Regex'];
                     
                     if (isset($lines[$i+1])) {
                         // Double check next line isn't Odběratel
                         if ($isSupplierAttr && mb_stripos($lines[$i+1], 'Odběratel') !== false) { /* skip */ }
                         else if (preg_match('/\b\d{8}\b/', $lines[$i+1], $m)) {
                            return ['value' => $m[0], 'confidence' => 'High', 'strategy' => 'ICO_Regex_NextLine'];
                         }
                     }
                }

                // 3. DIČ / VAT ID
                if ($code === 'SUPPLIER_VAT_ID') {
                     if (preg_match('/\bCZ\d{8,10}\b/i', $suffix, $m)) return ['value' => strtoupper($m[0]), 'confidence' => 'High', 'strategy' => 'VATID_Regex'];
                     if (isset($lines[$i+1]) && preg_match('/\bCZ\d{8,10}\b/i', $lines[$i+1], $m)) {
                        return ['value' => strtoupper($m[0]), 'confidence' => 'High', 'strategy' => 'VATID_Regex_NextLine'];
                     }
                }

                // 4. Variable Symbol (digits, usually 10 max) & Constant Symbol
                if ($code === 'VARIABLE_SYMBOL' || $code === 'CONSTANT_SYMBOL') {
                     if (preg_match('/\b\d{1,10}\b/', $suffix, $m)) return ['value' => $m[0], 'confidence' => 'Medium', 'strategy' => 'Symbol_Regex'];
                     if (isset($lines[$i+1]) && preg_match('/\b\d{1,10}\b/', $lines[$i+1], $m)) {
                        return ['value' => $m[0], 'confidence' => 'Medium', 'strategy' => 'Symbol_Regex_NextLine'];
                     }
                }
                
                // 5. VAT Rates (Base/Amount)
                if (strpos($code, 'VAT_') === 0) {
                     $val = $this->parseValue($suffix, 'number', $code);
                     if ($val) return ['value' => $val, 'confidence' => 'Medium', 'strategy' => 'VAT_SameLine'];
                }

                // --- GENERIC TYPE LOGIC WITH DIRECTION ---
                $direction = $scanDirection ?? 'auto';
                
                // Strategy A: Same Line (Right)
                if ($direction === 'auto' || $direction === 'right') {
                    $val = $this->parseValue($suffix, $dataType, $code);
                    
                    // FILTER: Validate Supplier Name
                    if ($code === 'SUPPLIER_NAME' && $val) {
                        if (mb_stripos($val, 'Faktura') !== false || mb_stripos($val, 'Doklad') !== false) $val = null;
                        if (is_numeric(str_replace([' ','.'], '', $val))) $val = null; 
                    }

                    if ($val) return ['value' => $val, 'confidence' => 'High', 'strategy' => 'SameLine'];
                }

                // Strategy B: Next Line (Down)
                if ($direction === 'auto' || $direction === 'down') {
                    if (isset($lines[$i+1])) {
                        $nextLine = trim($lines[$i+1]);
                        if (!preg_match('/:$/', $nextLine)) { 
                             $val = $this->parseValue($nextLine, $dataType, $code);
                             
                             if ($code === 'SUPPLIER_NAME' && $val) {
                                 if (mb_stripos($val, 'Faktura') !== false || mb_stripos($val, 'Doklad') !== false) $val = null;
                                 if (is_numeric(str_replace([' ','.'], '', $val))) $val = null; 
                             }

                             if ($val) return ['value' => $val, 'confidence' => 'Medium', 'strategy' => 'NextLine'];
                        }
                    }
                }
            }
        }
        
        // SPECIAL FALLBACKS FOR ITEMS (Corrected structure)

        // SPECIAL LOGIC: TOTAL AMOUNT (Global Search)
        if ($code === 'TOTAL_AMOUNT') {
            foreach ($lines as $line) {
                // Look for "Celkem", "K úhradě", "Částka", "K zaplacení"
                if (preg_match('/(celkem|k úhradě|k zaplacení|částka)\s*[:\s]*([\d\s\.,]+)\s*(?:kč|eur|czk)?/iu', $line, $m)) {
                     // Check if it's a valid amount
                     $val = $this->parseValue($m[2], 'number', $code);
                     if ($val && $val > 0) return ['value' => $val, 'confidence' => 'Medium', 'strategy' => 'TotalAmount_Regex'];
                }
            }
        }

        // SPECIAL LOGIC: BANK CODE
        if ($code === 'BANK_CODE') {
             // Look for account pattern: 123456/BANK_CODE
             // Try to find any /XXXX pattern where XXXX are digits
             foreach ($lines as $line) {
                 if (preg_match('#/(\d{4})\b#', $line, $m)) {
                     return ['value' => $m[1], 'confidence' => 'High', 'strategy' => 'BankCode_Slash'];
                 }
             }
        }
        
        // CUSTOMER NAME (Buyer) - Similar to Supplier but for "Odběratel" / "Příjemce"
        if ($code === 'CUSTOMER_NAME') {
             foreach ($lines as $i => $line) {
                 if (mb_stripos($line, 'Odběratel') !== false || mb_stripos($line, 'Příjemce') !== false) {
                     // Try Next Line first as it's most common for address blocks
                     if (isset($lines[$i+1])) {
                         $val = trim($lines[$i+1]);
                         // Basic validation: not empty, not just a number
                         if ($val && !is_numeric(str_replace(' ', '', $val))) {
                             return ['value' => $val, 'confidence' => 'Medium', 'strategy' => 'Customer_NextLine'];
                         }
                     }
                 }
             }
        }

        // SPECIAL FALLBACKS FOR ITEMS
        if ($code === 'INVOICE_ITEMS') {
             foreach ($lines as $i => $line) {
                 if (mb_stripos($line, 'Fakturujeme Vám') !== false || mb_stripos($line, 'Označení dodávky') !== false || mb_stripos($line, 'Položky') !== false) {
                     $items = [];
                     for($k=1; $k<=10; $k++) {
                         if (isset($lines[$i+$k])) {
                             $l = trim($lines[$i+$k]);
                             if (mb_stripos($l, 'Celkem') !== false || mb_stripos($l, 'Součet') !== false || mb_stripos($l, 'K úhradě') !== false) break;
                             
                             // Skip empty lines or table headers
                             if (mb_strlen($l) < 3) continue;
                             if (mb_stripos($l, 'Cena bez DPH') !== false || mb_stripos($l, 'Sazba DPH') !== false || mb_stripos($l, 'DPH') !== false) continue;
                             if (mb_stripos($l, 'Množství') !== false || mb_stripos($l, 'Jednotková cena') !== false) continue;

                             $items[] = $l;
                         }
                     }
                     if (!empty($items)) {
                         return ['value' => implode('; ', $items), 'confidence' => 'Low', 'strategy' => 'Items_Block'];
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
        // Reassemble
        $candidate = implode(' ', $cleanParts);

        // Actually for Date/Number we extract specifically. For text we accept the cut.
        if ($dataType === 'text') {
            // For Supplier Name, check for "Variabilní symbol" or other distinct blocks on the same line
            if ($code === 'SUPPLIER_NAME') {
                $stopPhrases = ['variabilní', 'konstantní', 'specifický', 'objednávka', 'ze dne', 'datum', 'odběratel', 'příjemce', 'banka', 'účet', 'iban', 'bic'];
                foreach ($stopPhrases as $stop) {
                    $idx = mb_stripos($candidate, $stop);
                    if ($idx !== false) {
                        $candidate = mb_substr($candidate, 0, $idx);
                        break;
                    }
                }
                $candidate = trim($candidate);
                
                // If the candidate becomes empty after stripping distinct blocks (e.g. "Dodavatel:               Variabilní symbol..."), return null to force NextLine strategy
                if (empty($candidate)) return null;
            }
            return $candidate;
        }

        if ($dataType === 'number') {
            // Money or Counts
            // Remove spaces, handle comma/dot
            // Example: "1 234,50" -> 1234.50 (Czech)
            
            // Clean non-numeric stuff but keep delimiters
            if (preg_match('/[\d\s\.,]+/', $rawStr, $matches)) {
                $numStr = $matches[0];
                // 1. Remove spaces (thousands separator in CZ)
                $numStr = str_replace(' ', '', $numStr);
                $numStr = str_replace("\xc2\xa0", '', $numStr); // Non-breaking space
                
                // 2. Decide decimal separator
                if (strpos($numStr, '.') !== false && strpos($numStr, ',') !== false) {
                    $lastDot = strrpos($numStr, '.');
                    $lastComma = strrpos($numStr, ',');
                    if ($lastComma > $lastDot) {
                        $numStr = str_replace('.', '', $numStr);
                        $numStr = str_replace(',', '.', $numStr);
                    } else {
                        $numStr = str_replace(',', '', $numStr);
                    }
                } elseif (strpos($numStr, ',') !== false) {
                    $numStr = str_replace(',', '.', $numStr);
                }
                
                return floatval($numStr);
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
                 error_log("OcrEngine: pdftotext gave little/no text (" . strlen($text) . " chars). Trying fallback to Tesseract on PDF.");
                 // Try tesseract on PDF directly
                 // Note: Expects Tesseract 4/5 with PDF support
                 $cmd = "tesseract " . escapeshellarg($filepath) . " stdout -l ces+eng";
                 $output = [];
                 $code = 0;
                 exec($cmd, $output, $code);
                 if ($code === 0 && !empty($output)) {
                     $ocrText = implode("\n", $output);
                     if (strlen(trim($ocrText)) > strlen(trim($text))) {
                         $text = $ocrText;
                         error_log("OcrEngine: Tesseract fallback successful (" . strlen($text) . " chars).");
                     }
                 } else {
                     error_log("OcrEngine: Tesseract fallback failed (code $code).");
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

        error_log("OcrEngine: Final extracted text length: " . strlen($text));
        if (strlen($text) < 100) error_log("OcrEngine: Text preview: " . $text);
        
        return $text;
    }
}
