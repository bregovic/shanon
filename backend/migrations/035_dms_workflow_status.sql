-- Migration: 035_dms_workflow_status.sql
-- Description: Add 'status' column for business workflow (new, processing, review, approved, rejected, exported)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_documents' AND column_name='status') THEN
        ALTER TABLE dms_documents ADD COLUMN status VARCHAR(20) DEFAULT 'new';
        
        -- Migrate existing data
        -- If OCR is completed, assume it is ready for review (or already reviewed if we don't know).
        -- Let's set everything to 'review' if OCR is done, otherwise 'processing' or 'new'.
        UPDATE dms_documents SET status = 'review' WHERE ocr_status = 'completed';
        UPDATE dms_documents SET status = 'processing' WHERE ocr_status IN ('pending', 'processing');
        UPDATE dms_documents SET status = 'new' WHERE ocr_status = 'new';
    END IF;
END $$;
