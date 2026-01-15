<?php
// backend/migrations/030_org_expansion.sql

-- 1. Extend sys_organizations table
DO $$ 
BEGIN 
    -- Contact Info
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='contact_email') THEN
        ALTER TABLE sys_organizations ADD COLUMN contact_email VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='contact_phone') THEN
        ALTER TABLE sys_organizations ADD COLUMN contact_phone VARCHAR(50);
    END IF;
    
    -- Banking & Official
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='bank_account') THEN
        ALTER TABLE sys_organizations ADD COLUMN bank_account VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='bank_code') THEN
        ALTER TABLE sys_organizations ADD COLUMN bank_code VARCHAR(10);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='data_box_id') THEN
        ALTER TABLE sys_organizations ADD COLUMN data_box_id VARCHAR(20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='city') THEN
        ALTER TABLE sys_organizations ADD COLUMN city VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='zip') THEN
        ALTER TABLE sys_organizations ADD COLUMN zip VARCHAR(20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='street') THEN
        ALTER TABLE sys_organizations ADD COLUMN street VARCHAR(200);
    END IF;
END $$;

-- 2. Register Security Object
INSERT INTO sys_security_objects (identifier, type, display_name, description)
VALUES ('mod_orgs', 'module', 'Organizace', 'Správa firemních entit a fakturačních údajů.')
ON CONFLICT (identifier) DO NOTHING;

-- 3. Grant Admin Access
INSERT INTO sys_security_permissions (role_id, object_id, access_level)
SELECT r.rec_id, o.rec_id, 3
FROM sys_security_roles r, sys_security_objects o
WHERE r.code = 'ADMIN' AND o.identifier = 'mod_orgs'
ON CONFLICT DO NOTHING;

-- Log
INSERT INTO development_history (date, title, description, category, created_at)
SELECT CURRENT_DATE, 'Module Organizations', 'Database expansion and security registration for Organization management.', 'Feature', NOW()
WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Module Organizations' AND date = CURRENT_DATE);
