-- 003_dms_setup.sql
-- Shanon DMS: Number Series & Extended Setup

-- ================================================
-- 1. NUMBER SERIES (Číselné řady)
-- ================================================
CREATE TABLE IF NOT EXISTS dms_number_series (
    rec_id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    code VARCHAR(20) NOT NULL,           -- e.g. "DOC", "FAK", "SMV"
    name VARCHAR(100) NOT NULL,          -- e.g. "Dokumenty", "Faktury"
    prefix VARCHAR(20) DEFAULT '',       -- e.g. "DOC-", "FAK-2024-"
    suffix VARCHAR(20) DEFAULT '',       -- e.g. "-A"
    current_number INTEGER DEFAULT 0,    -- Last used number
    number_length INTEGER DEFAULT 5,     -- Padding: 00001
    is_default BOOLEAN DEFAULT false,    -- Default series for new docs
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES sys_users(rec_id),
    UNIQUE(tenant_id, code)
);

-- ================================================
-- 2. EXTEND DOC TYPES with Number Series link
-- ================================================
ALTER TABLE dms_doc_types 
ADD COLUMN IF NOT EXISTS number_series_id INTEGER REFERENCES dms_number_series(rec_id);

ALTER TABLE dms_doc_types 
ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE dms_doc_types 
ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'Document24Regular';

-- ================================================
-- 3. EXTEND ATTRIBUTES with more metadata
-- ================================================
ALTER TABLE dms_attributes 
ADD COLUMN IF NOT EXISTS is_searchable BOOLEAN DEFAULT true;

ALTER TABLE dms_attributes 
ADD COLUMN IF NOT EXISTS default_value VARCHAR(500);

ALTER TABLE dms_attributes 
ADD COLUMN IF NOT EXISTS validation_regex VARCHAR(200);

ALTER TABLE dms_attributes 
ADD COLUMN IF NOT EXISTS help_text VARCHAR(500);

-- ================================================
-- 4. SEED DATA: Default Number Series
-- ================================================
INSERT INTO dms_number_series (tenant_id, code, name, prefix, current_number, number_length, is_default, is_active)
VALUES 
    ('00000000-0000-0000-0000-000000000001', 'DOC', 'Obecné dokumenty', 'DOC-', 0, 5, true, true),
    ('00000000-0000-0000-0000-000000000001', 'FAK', 'Faktury', 'FAK-', 0, 6, false, true),
    ('00000000-0000-0000-0000-000000000001', 'SMV', 'Smlouvy', 'SMV-', 0, 4, false, true)
ON CONFLICT DO NOTHING;

-- ================================================
-- 5. Link existing doc types to number series
-- ================================================
UPDATE dms_doc_types 
SET number_series_id = (SELECT rec_id FROM dms_number_series WHERE code = 'DOC' LIMIT 1)
WHERE number_series_id IS NULL;

-- Specific links
UPDATE dms_doc_types 
SET number_series_id = (SELECT rec_id FROM dms_number_series WHERE code = 'FAK' LIMIT 1)
WHERE code = 'FAK_IN';

UPDATE dms_doc_types 
SET number_series_id = (SELECT rec_id FROM dms_number_series WHERE code = 'SMV' LIMIT 1)
WHERE code = 'CONTRACT';
