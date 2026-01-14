-- Migration: 030_dms_doc_type_attributes
-- Description: Link attributes to specific document types for tailored extraction forms.

DO $$
BEGIN
    -- 1. Create Link Table
    CREATE TABLE IF NOT EXISTS dms_doc_type_attributes (
        rec_id SERIAL PRIMARY KEY,
        doc_type_id INT NOT NULL REFERENCES dms_doc_types(rec_id) ON DELETE CASCADE,
        attribute_id INT NOT NULL REFERENCES dms_attributes(rec_id) ON DELETE CASCADE,
        
        is_required BOOLEAN DEFAULT FALSE,
        display_order INT DEFAULT 0,
        
        UNIQUE(doc_type_id, attribute_id)
    );

    -- 2. Add 'status' column to dms_documents if not exists (for workflow)
    -- Start with 'fresh', 'review', 'valid', 'exported'
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_documents' AND column_name='status') THEN
        ALTER TABLE dms_documents ADD COLUMN status VARCHAR(20) DEFAULT 'fresh';
        -- Update existing to 'fresh' or 'valid' based on ocr_status
        UPDATE dms_documents SET status = 'valid' WHERE ocr_status = 'done';
    END IF;

    -- 3. Log into history
    INSERT INTO development_history (date, title, description, category, created_at)
    SELECT CURRENT_DATE, 'Attribute Maps per DocType', 'Created dms_doc_type_attributes to allow different fields for Invoices vs Contracts.', 'feature', NOW()
    WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Attribute Maps per DocType' AND date = CURRENT_DATE);

END $$;
