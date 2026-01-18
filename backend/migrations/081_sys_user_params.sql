-- 081_sys_user_params.sql
-- Description: Store user-specific UI preferences
-- Fixed: Robust check for org_id column existence

DO $$ 
BEGIN 
    -- 1. Create table if completely missing
    CREATE TABLE IF NOT EXISTS sys_user_params (
        rec_id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        user_id INTEGER NOT NULL REFERENCES sys_users(rec_id) ON DELETE CASCADE,
        param_key VARCHAR(100) NOT NULL,
        param_value JSONB,
        updated_at TIMESTAMP DEFAULT NOW()
    );

    -- 2. Ensure org_id column exists (add if missing)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_user_params' AND column_name='org_id') THEN
        ALTER TABLE sys_user_params ADD COLUMN org_id CHAR(5);
    END IF;
END $$;

-- 3. Create Indexes (Safe to run multiple times)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_params_global 
    ON sys_user_params (user_id, param_key) 
    WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_params_org 
    ON sys_user_params (user_id, param_key, org_id) 
    WHERE org_id IS NOT NULL;
