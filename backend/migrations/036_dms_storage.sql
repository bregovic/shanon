-- Migration: 036_dms_storage.sql
-- Description: Create table for dynamic storage profiles (Robust Check)
-- Created: 2026-01-15

-- 1. Create table if totally missing
CREATE TABLE IF NOT EXISTS dms_storage_profiles (
    rec_id SERIAL PRIMARY KEY,
    tenant_id UUID,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'local',
    configuration JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Fix Schema if table existed with old structure (migration 024)
DO $$ 
BEGIN 
    -- Ensure 'type' column exists (Old schema had 'storage_type')
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='type') THEN
        ALTER TABLE dms_storage_profiles ADD COLUMN type VARCHAR(50) DEFAULT 'local';
        
        -- Migrate data from old column if it exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='storage_type') THEN
             UPDATE dms_storage_profiles SET type = storage_type;
        END IF;
    END IF;

    -- Ensure 'configuration' column exists (Old schema had base_path/conn_string)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='configuration') THEN
        ALTER TABLE dms_storage_profiles ADD COLUMN configuration JSONB DEFAULT '{}';
    END IF;
    
    -- Ensure 'is_default' exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='is_default') THEN
        ALTER TABLE dms_storage_profiles ADD COLUMN is_default BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 3. Seed Data (Now safe to use 'type' column)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dms_storage_profiles WHERE type = 'local') THEN
        INSERT INTO dms_storage_profiles (name, type, is_active, is_default) 
        VALUES ('Lokální úložiště', 'local', true, true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM dms_storage_profiles WHERE type = 'google_drive') THEN
        INSERT INTO dms_storage_profiles (name, type, is_active, is_default) 
        VALUES ('Google Drive', 'google_drive', true, false);
    END IF;
END $$;
