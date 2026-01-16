-- Migration: 016_user_org_roles.sql
-- Description: Creates table for User <-> Org assignment with contextual roles

CREATE TABLE IF NOT EXISTS sys_user_org_access (
    rec_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES sys_users(rec_id) ON DELETE CASCADE,
    org_id VARCHAR(50) NOT NULL,
    roles JSONB DEFAULT '[]'::jsonb, -- Array of role codes e.g. ["ADMIN", "MANAGER"]
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_user_org_access_user ON sys_user_org_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_access_org ON sys_user_org_access(org_id);
