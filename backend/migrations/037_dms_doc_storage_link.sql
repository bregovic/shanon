-- Migration: 037_dms_doc_storage_link.sql
-- Description: Link documents to storage profiles
-- Created: 2026-01-15

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_documents' AND column_name='storage_profile_id') THEN
        ALTER TABLE dms_documents ADD COLUMN storage_profile_id INTEGER REFERENCES dms_storage_profiles(rec_id);
    END IF;
END $$;

-- Set default storage profile for existing documents (Local)
UPDATE dms_documents 
SET storage_profile_id = (SELECT rec_id FROM dms_storage_profiles WHERE type='local' ORDER BY rec_id LIMIT 1) 
WHERE storage_profile_id IS NULL;
