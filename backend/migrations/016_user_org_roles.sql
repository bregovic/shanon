-- Migration: 016_user_org_roles.sql
-- Description: Creates User <-> Org assignment tables

-- 1. Organizations (Entities within Tenant)
CREATE TABLE IF NOT EXISTS sys_organizations (
    rec_id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    org_id VARCHAR(50) NOT NULL UNIQUE, -- e.g. 'VACKR'
    display_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. User Access Mapping (User <-> Org)
CREATE TABLE IF NOT EXISTS sys_user_org_access (
    rec_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES sys_users(rec_id) ON DELETE CASCADE,
    org_id VARCHAR(50) NOT NULL, -- Logical link to sys_organizations(org_id)
    roles JSONB DEFAULT '[]'::jsonb, -- Array of role codes e.g. ["ADMIN", "MANAGER"]
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_user_org_access_user ON sys_user_org_access(user_id);
