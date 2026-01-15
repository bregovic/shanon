-- Migration: 036_dms_storage.sql
-- Description: Create table for dynamic storage profiles
-- Created: 2026-01-15

CREATE TABLE IF NOT EXISTS dms_storage_profiles (
    rec_id SERIAL PRIMARY KEY,
    tenant_id UUID,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    configuration JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Local Profile if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dms_storage_profiles WHERE type = 'local') THEN
        INSERT INTO dms_storage_profiles (name, type, is_active, is_default) 
        VALUES ('Lokální úložiště', 'local', true, true);
    END IF;
END $$;

-- Seed Google Drive Profile if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dms_storage_profiles WHERE type = 'google_drive') THEN
        INSERT INTO dms_storage_profiles (name, type, is_active, is_default) 
        VALUES ('Google Drive', 'google_drive', true, false);
    END IF;
END $$;
