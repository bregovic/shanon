-- 081_sys_user_params.sql
-- Description: Store user-specific UI preferences (grid layouts, etc.)

CREATE TABLE IF NOT EXISTS sys_user_params (
    rec_id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    user_id INTEGER NOT NULL REFERENCES sys_users(rec_id) ON DELETE CASCADE,
    org_id CHAR(5), -- Optional: if param is org-specific
    param_key VARCHAR(100) NOT NULL,
    param_value JSONB,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique constraints handling NULL org_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_params_global 
    ON sys_user_params (user_id, param_key) 
    WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_params_org 
    ON sys_user_params (user_id, param_key, org_id) 
    WHERE org_id IS NOT NULL;
