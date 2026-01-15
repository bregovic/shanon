<?php
// backend/migrations/029_add_user_settings.sql

// Add JSON 'settings' column to sys_users for storing user preferences (language, theme, etc.)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_users' AND column_name='settings') THEN
        ALTER TABLE sys_users ADD COLUMN settings JSONB DEFAULT '{}';
    END IF;
END $$;

// Insert History log
INSERT INTO development_history (date, title, description, category, created_at)
SELECT CURRENT_DATE, 'Add User Settings Column', 'Added JSONB settings column to sys_users for storing language, theme, and other personal preferences.', 'Feature', NOW()
WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Add User Settings Column' AND date = CURRENT_DATE);
