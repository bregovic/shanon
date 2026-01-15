-- Migration: 036_dms_storage.sql (v3)
-- Description: Create table for dynamic storage profiles with legacy schema cleanup
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

-- 2. Fix Schema - Handle legacy columns (storage_type, provider_type)
DO $$ 
BEGIN 
    -- A) Handle 'provider_type' (Legacy ghost column causing NOT NULL violations)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='provider_type') THEN
        -- Make it NULLABLE to prevent insert errors
        BEGIN
            EXECUTE 'ALTER TABLE dms_storage_profiles ALTER COLUMN provider_type DROP NOT NULL';
        EXCEPTION WHEN OTHERS THEN
            -- Ignore if validation fails or already nullable
            NULL;
        END;
    END IF;

    -- B) Ensure 'type' column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='type') THEN
        ALTER TABLE dms_storage_profiles ADD COLUMN type VARCHAR(50) DEFAULT 'local';
        
        -- Try to migrate data from old columns if they exist
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='storage_type') THEN
             UPDATE dms_storage_profiles SET type = storage_type;
        END IF;
        -- Or from provider_type
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='provider_type') THEN
             UPDATE dms_storage_profiles SET type = provider_type WHERE type IS NULL OR type = 'local';
        END IF;
    END IF;

    -- C) Ensure 'configuration' column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='configuration') THEN
        ALTER TABLE dms_storage_profiles ADD COLUMN configuration JSONB DEFAULT '{}';
    END IF;
    
    -- D) Ensure other flags
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_storage_profiles' AND column_name='is_default') THEN
        ALTER TABLE dms_storage_profiles ADD COLUMN is_default BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 3. Seed Data
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
