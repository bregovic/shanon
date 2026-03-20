DO $$ 
BEGIN 
    -- 1. Main Table
    CREATE TABLE IF NOT EXISTS gab_subjects (
        rec_id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        reg_no VARCHAR(50), -- IČO
        tax_no VARCHAR(50), -- DIČ
        country_iso CHAR(2) DEFAULT 'CZ',
        language CHAR(2) DEFAULT 'cs',
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(100) DEFAULT 'System',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(100)
    );

    -- Tvrdá blokace IČO duplicit pro konkrétní tenant, pokud je vyplněno
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gab_subj_reg_no 
    ON gab_subjects (tenant_id, reg_no) WHERE reg_no IS NOT NULL AND reg_no != '';

    -- 2. Roles (Hodnoty: INTERNAL_ORG, EMPLOYEE, CUSTOMER, VENDOR)
    CREATE TABLE IF NOT EXISTS gab_subject_roles (
        rec_id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        subject_id INT NOT NULL REFERENCES gab_subjects(rec_id) ON DELETE CASCADE,
        role_code VARCHAR(50) NOT NULL, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, subject_id, role_code)
    );

    -- 3. Addresses
    CREATE TABLE IF NOT EXISTS gab_addresses (
        rec_id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        subject_id INT NOT NULL REFERENCES gab_subjects(rec_id) ON DELETE CASCADE,
        address_type VARCHAR(50) NOT NULL, -- BILLING, SHIPPING, OTHER
        street VARCHAR(255) NOT NULL,
        city VARCHAR(100),
        zip_code VARCHAR(20),
        country_iso CHAR(2) DEFAULT 'CZ',
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 4. Contacts
    CREATE TABLE IF NOT EXISTS gab_contacts (
        rec_id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        subject_id INT NOT NULL REFERENCES gab_subjects(rec_id) ON DELETE CASCADE,
        contact_type VARCHAR(50) NOT NULL, -- EMAIL, PHONE, WEB
        contact_value VARCHAR(255) NOT NULL,
        is_primary BOOLEAN DEFAULT false,
        description VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Index pro vyhledávání a warning na duplicitu emailu/telefonu
    CREATE INDEX IF NOT EXISTS idx_gab_contact_val ON gab_contacts (tenant_id, contact_value);

    -- 5. Link in sys_organizations
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_organizations' AND column_name='gab_subject_id') THEN
        ALTER TABLE sys_organizations ADD COLUMN gab_subject_id INT REFERENCES gab_subjects(rec_id);
    END IF;

    -- 6. Link in sys_users
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sys_users' AND column_name='gab_subject_id') THEN
        ALTER TABLE sys_users ADD COLUMN gab_subject_id INT REFERENCES gab_subjects(rec_id);
    END IF;

END $$;
