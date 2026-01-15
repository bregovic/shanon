-- Migration: Add ocr_data column for structured OCR results (words positions)
ALTER TABLE dms_documents ADD COLUMN IF NOT EXISTS ocr_data jsonb NULL;
