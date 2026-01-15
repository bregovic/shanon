
DO $$ 
BEGIN 
    -- 1. Add options column for enumeration values
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_attributes' AND column_name='options') THEN 
        ALTER TABLE dms_attributes ADD COLUMN options JSONB DEFAULT '[]'; 
    END IF;

    -- 2. Validate/Add other columns used in frontend settings if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_attributes' AND column_name='default_value') THEN 
        ALTER TABLE dms_attributes ADD COLUMN default_value TEXT DEFAULT ''; 
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_attributes' AND column_name='help_text') THEN 
        ALTER TABLE dms_attributes ADD COLUMN help_text TEXT DEFAULT ''; 
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dms_attributes' AND column_name='scan_direction') THEN 
        ALTER TABLE dms_attributes ADD COLUMN scan_direction VARCHAR(20) DEFAULT 'auto'; 
    END IF;
END $$;

INSERT INTO development_history (date, title, description, category, created_at)
SELECT CURRENT_DATE, 'DMS Attribute Options', 'Added JSONB column for attribute enumeration options and missing columns for settings.', 'Backend', NOW()
WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'DMS Attribute Options' AND date = CURRENT_DATE);
