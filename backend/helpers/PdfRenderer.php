<?php

class PdfRenderer {
    public static function renderPage($pdfPath, $pageIndex = 0) {
        // 1. Try Imagick
        if (class_exists('Imagick')) {
            try {
                $imagick = new Imagick();
                // [0] means page 1
                $imagick->readImage($pdfPath . '[' . $pageIndex . ']');
                $imagick->setImageFormat('jpg');
                $imagick->setImageCompressionQuality(90);
                return $imagick->getImageBlob();
            } catch (Exception $e) {
                // Log warning?
            }
        }

        // 2. Try Ghostscript (gs)
        // Check if gs is available
        // Simple command: gs -sDEVICE=jpeg -o - -dFirstPage=1 -dLastPage=1 -r150 file.pdf
        // Windows: gswin64c usually
        $gsBin = self::findGhostscript();
        if ($gsBin) {
            $cmd = sprintf(
                '"%s" -dNOPAUSE -dBATCH -sDEVICE=jpeg -dFirstPage=%d -dLastPage=%d -sOutputFile=- -q "%s"',
                $gsBin,
                $pageIndex + 1,
                $pageIndex + 1,
                $pdfPath
            );
            $output = shell_exec($cmd);
            if ($output) return $output;
        }

        return false;
    }

    private static function findGhostscript() {
        // Common windows paths
        $paths = [
            'C:\Program Files\gs\gs*\bin\gswin64c.exe',
            'C:\Program Files\gs\gs*\bin\gswin32c.exe',
        ];
        
        // Check PATH
        // exec('where gswin64c', $out, $ret);
        // if ($ret === 0) return 'gswin64c';

        // Check Windows Paths
        foreach ($paths as $pattern) {
            $found = glob($pattern);
            if ($found && isset($found[0])) return $found[0]; // Return first match
        }
        
        return null;
    }
}
