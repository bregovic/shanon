-- 080_shared_companies.sql
-- Description: Implement Shared Companies (Virtual Tenants)
-- Goal: Allow data inheritance between companies

-- 1. Add Virtual Flag to Organizations
-- This distinguishes standard companies from "Shared Groups" (like 'ALL')
ALTER TABLE sys_organizations ADD COLUMN IF NOT EXISTS is_virtual_group BOOLEAN DEFAULT false;

-- 2. Organization Group Membership
-- Defines structure: "Company VACKR belongs to Group ALL"
CREATE TABLE IF NOT EXISTS sys_org_group_members (
    group_id CHAR(5) NOT NULL REFERENCES sys_organizations(org_id) ON DELETE CASCADE,
    member_id CHAR(5) NOT NULL REFERENCES sys_organizations(org_id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (group_id, member_id),
    CONSTRAINT chk_diff_orgs CHECK (group_id <> member_id)
);

-- 3. Shared Tables Configuration
-- Defines WHICH tables are shared for a specific virtual group
-- Example: Group 'ALL' shares table 'sys_currencies'
CREATE TABLE IF NOT EXISTS sys_org_shared_tables (
    rec_id SERIAL PRIMARY KEY,
    group_id CHAR(5) NOT NULL REFERENCES sys_organizations(org_id) ON DELETE CASCADE,
    table_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_id, table_name)
);

-- Index for fast lookup during queries
CREATE INDEX IF NOT EXISTS idx_shared_tables_lookup ON sys_org_shared_tables(group_id, table_name);

-- 4. Initial Seed (Optional) - Create 'ALL' group if desired templates exist
-- For now we leave it empty to be configured via UI
