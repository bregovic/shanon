<?php
class ImageOptimizer {
    
    /**
     * Optimalizuje obrázek (zmenšení + komprese)
     * 
     * @param string $sourcePath Cesta ke zdrojovému souboru
     * @param string $targetPath Cesta, kam uložit výsledek (může být stejná)
     * @param int $quality Kvalita komprese (0-100), default 80
     * @param int $maxWidth Maximální šířka, default 1920
     * @param int $maxHeight Maximální výška, default 1920
     * @return bool True pokud se optimalizace podařila (nebo nebyla třeba), False při chybě
     */
    public static function optimize($sourcePath, $targetPath, $quality = 80, $maxWidth = 1920, $maxHeight = 1920) {
        if (!file_exists($sourcePath)) return false;

        $info = getimagesize($sourcePath);
        if (!$info) return false; // Není obrázek

        $mime = $info['mime'];
        $width = $info[0];
        $height = $info[1];

        // Načtení obrázku
        switch ($mime) {
            case 'image/jpeg': $image = imagecreatefromjpeg($sourcePath); break;
            case 'image/png': $image = imagecreatefrompng($sourcePath); break;
            case 'image/webp': $image = imagecreatefromwebp($sourcePath); break;
            default: return false; // Nepodporovaný formát
        }

        if (!$image) return false;

        // Výpočet nových rozměrů (zachování poměru stran)
        $newWidth = $width;
        $newHeight = $height;
        $resizeNeeded = false;

        if ($width > $maxWidth || $height > $maxHeight) {
            $ratio = $width / $height;
            if ($ratio > 1) {
                // Široký
                if ($width > $maxWidth) {
                    $newWidth = $maxWidth;
                    $newHeight = $maxWidth / $ratio;
                    $resizeNeeded = true;
                }
            } else {
                // Vysoký
                if ($height > $maxHeight) {
                    $newHeight = $maxHeight;
                    $newWidth = $maxHeight * $ratio;
                    $resizeNeeded = true;
                }
            }
        }

        // Pokud je potřeba resize
        if ($resizeNeeded) {
            $newImage = imagecreatetruecolor($newWidth, $newHeight);
            
            // Zachování průhlednosti pro PNG/WebP
            if ($mime == 'image/png' || $mime == 'image/webp') {
                imagealphablending($newImage, false);
                imagesavealpha($newImage, true);
                $transparent = imagecolorallocatealpha($newImage, 255, 255, 255, 127);
                imagefilledrectangle($newImage, 0, 0, $newWidth, $newHeight, $transparent);
            }

            imagecopyresampled($newImage, $image, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
            imagedestroy($image);
            $image = $newImage;
        }

        // Uložení
        $result = false;
        switch ($mime) {
            case 'image/jpeg': 
                $result = imagejpeg($image, $targetPath, $quality); 
                break;
            case 'image/png': 
                // PNG kvalita je 0-9, kde 0 je bez komprese. Přepočet z 0-100 na 9-0.
                $pngQuality = round((100 - $quality) / 10); // zhruba 7-9
                $result = imagepng($image, $targetPath, (int)$pngQuality); 
                break;
            case 'image/webp': 
                $result = imagewebp($image, $targetPath, $quality); 
                break;
        }

        imagedestroy($image);
        return $result;
    }
}
