-- 041_dms_isolation.sql
-- Add Tenant and Org Isolation to DMS Configuration Tables

-- 1. DMS Document Types
ALTER TABLE dms_doc_types ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE dms_doc_types ADD COLUMN IF NOT EXISTS org_id VARCHAR(5) DEFAULT NULL;

-- Fix Constraints for Doc Types
-- We need to drop old unique constraints that didn't include tenant/org
-- Note: Constraint names might vary, so we try to drop by column names if possible or generic names.
-- PostgreSQL creates implicit index/constraint updates usually, but best to be explicit.

ALTER TABLE dms_doc_types DROP CONSTRAINT IF EXISTS dms_doc_types_name_key;
ALTER TABLE dms_doc_types DROP CONSTRAINT IF EXISTS dms_doc_types_code_key;

-- Add new scoped unique constraints
-- If org_id is NULL, it's a tenant-wide default.
-- If org_id is SET, it's an org-specific override.
-- UNIQUE index handling for NULLs in Postgres implies distinctness for NULLs, 
-- but we want: (tenant, code) unique WHERE org_id IS NULL 
-- AND (tenant, org, code) unique WHERE org_id IS NOT NULL.
-- Easier: Just make index on (tenant_id, code) where org_id IS NULL?

CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_types_tenant_code_default ON dms_doc_types (tenant_id, code) WHERE org_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_types_tenant_org_code ON dms_doc_types (tenant_id, org_id, code) WHERE org_id IS NOT NULL;


-- 2. DMS Storage Profiles
ALTER TABLE dms_storage_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE dms_storage_profiles ADD COLUMN IF NOT EXISTS org_id VARCHAR(5) DEFAULT NULL;

-- 3. DMS Attributes (Already touched? Let's verify)
-- Just ensuring tenant_id is there, checked via "Add if not exists" logic standardly, but let's be safe.
ALTER TABLE dms_attributes ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE dms_attributes ADD COLUMN IF NOT EXISTS org_id VARCHAR(5) DEFAULT NULL;

-- 4. DMS Number Series (Already has tenant_id)
-- Add org_id to allow Series per Org
ALTER TABLE dms_number_series ADD COLUMN IF NOT EXISTS org_id VARCHAR(5) DEFAULT NULL;
-- Drop old unique constraint
ALTER TABLE dms_number_series DROP CONSTRAINT IF EXISTS dms_number_series_tenant_id_code_key;
-- Add new indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_series_tenant_code_default ON dms_number_series (tenant_id, code) WHERE org_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_series_tenant_org_code ON dms_number_series (tenant_id, org_id, code) WHERE org_id IS NOT NULL;

-- Grant access on new columns/tables is implicit for owner, but if permissions are complex:
-- GRANT ALL ON ... TO admin; (Not needed for simple setup)
