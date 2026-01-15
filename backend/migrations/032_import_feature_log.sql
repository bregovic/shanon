-- Migration: 032_import_feature_log
-- Description: Log the new Import/OCR feature to development history

INSERT INTO development_history (date, title, description, category, created_at)
SELECT CURRENT_DATE, 'DMS Import & OCR v2', 'Implemented new Document Import integration with automatic OCR/Mapping check and PDF Preview for zoning.', 'feature', NOW()
WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'DMS Import & OCR v2' AND date = CURRENT_DATE);
