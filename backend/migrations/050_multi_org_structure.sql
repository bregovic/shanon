-- 050_multi_org_structure.sql
-- Description: Introduction of Multi-Organization Support (DataAreaId concept)
-- Organization: VACKR (Bc. Václav Král)

-- 1. Create Organizations Table
CREATE TABLE IF NOT EXISTS sys_organizations (
    org_id CHAR(5) PRIMARY KEY,
    tenant_id UUID NOT NULL, 
    display_name VARCHAR(100) NOT NULL,
    address TEXT,
    reg_no VARCHAR(20),
    tax_no VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed 'VACKR' Organization
-- Uses tenant_id from existing users or a fallback dummy UUID if DB is empty
DO $$
DECLARE 
    v_tenant UUID;
BEGIN
    SELECT tenant_id INTO v_tenant FROM sys_users LIMIT 1;
    
    -- Fallback UUID if no user exists yet
    IF v_tenant IS NULL THEN
        v_tenant := '00000000-0000-0000-0000-000000000000'; 
    END IF;

    -- Update or Insert VACKR
    -- We use Upsert logic to ensure correct name if it already exists partially
    INSERT INTO sys_organizations (org_id, tenant_id, display_name)
    VALUES ('VACKR', v_tenant, 'Bc. Václav Král')
    ON CONFLICT (org_id) DO UPDATE 
    SET display_name = EXCLUDED.display_name;
    
    -- Clean up old DEF01 if it was created by mistake in previous run
    -- DELETE FROM sys_organizations WHERE org_id = 'DEF01'; -- Optional safety
END $$;

-- 2. User Access Table
CREATE TABLE IF NOT EXISTS sys_user_org_access (
    user_id INT NOT NULL REFERENCES sys_users(rec_id) ON DELETE CASCADE,
    org_id CHAR(5) NOT NULL REFERENCES sys_organizations(org_id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,
    assigned_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, org_id)
);

-- Assign all existing users to VACKR
INSERT INTO sys_user_org_access (user_id, org_id, is_default)
SELECT u.rec_id, 'VACKR', true
FROM sys_users u
ON CONFLICT (user_id, org_id) DO UPDATE SET is_default = true;

-- 3. Add org_id to DMS Documents
ALTER TABLE dms_documents ADD COLUMN IF NOT EXISTS org_id CHAR(5);

-- Migrate existing documents to VACKR
-- Only update those that are NULL (new column) or were DEF01
UPDATE dms_documents SET org_id = 'VACKR' WHERE org_id IS NULL OR org_id = 'DEF01';

-- Create Index
CREATE INDEX IF NOT EXISTS idx_dms_documents_org ON dms_documents(org_id);

-- NOTE: sys_change_requests remains Shared (System) as requested.
