
-- 002_dms_core.sql
-- Module: Document Management System

-- 1. CONFIGURATION: Document Types
CREATE TABLE IF NOT EXISTS dms_doc_types (
    rec_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE, -- Invoice, Contract
    code VARCHAR(50) NOT NULL UNIQUE, -- INV, CON
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- 2. CONFIGURATION: Custom Attributes (Metadata definitions)
CREATE TABLE IF NOT EXISTS dms_attributes (
    rec_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL, -- e.g. "Total Amount"
    code VARCHAR(50) NOT NULL, -- e.g. "amount"
    data_type VARCHAR(20) DEFAULT 'string', -- string, number, date, boolean
    is_required BOOLEAN DEFAULT FALSE,
    doc_type_id INT REFERENCES dms_doc_types(rec_id) -- NULL = Global attribute
);

-- 3. CONFIGURATION: Storage Profiles
CREATE TABLE IF NOT EXISTS dms_storage_profiles (
    rec_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL, -- e.g. "Main FTP"
    provider_type VARCHAR(50) NOT NULL, -- local, ftp, sftp, gdrive, sharepoint, s3
    config_json TEXT, -- Encrypted JSON with host, user, pass, api_key
    base_path VARCHAR(255) DEFAULT '/',
    is_active BOOLEAN DEFAULT TRUE
);

-- 4. MAIN TABLE: Documents
CREATE TABLE IF NOT EXISTS dms_documents (
    rec_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    
    -- File Info
    display_name VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_extension VARCHAR(20),
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    
    -- Classification
    doc_type_id INT REFERENCES dms_doc_types(rec_id),
    
    -- Storage Location
    storage_profile_id INT REFERENCES dms_storage_profiles(rec_id),
    storage_path VARCHAR(500), -- Path relative to storage root
    external_url TEXT, -- If accessible via public URL
    
    -- OCR & Processing
    ocr_status VARCHAR(20) DEFAULT 'pending', -- pending, processing, done, failed
    ocr_text_content TEXT, -- Fulltext search content
    
    -- Meta
    created_by BIGINT, -- Link to sys_users
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. DATA: Attribute Values
CREATE TABLE IF NOT EXISTS dms_doc_attribute_values (
    rec_id BIGSERIAL PRIMARY KEY,
    document_id BIGINT REFERENCES dms_documents(rec_id) ON DELETE CASCADE,
    attribute_id INT REFERENCES dms_attributes(rec_id),
    value_text TEXT,
    value_number NUMERIC,
    value_date TIMESTAMP
);

-- Seed Basic Types
INSERT INTO dms_doc_types (name, code) VALUES 
('Obecný dokument', 'GEN'),
('Faktura přijatá', 'INV_IN'),
('Smlouva', 'CON')
ON CONFLICT DO NOTHING;

-- Seed Default Storage (Local)
INSERT INTO dms_storage_profiles (name, provider_type, base_path) VALUES
('Lokální úložiště', 'local', 'uploads/')
ON CONFLICT DO NOTHING;
