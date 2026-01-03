-- 001_init_core.sql
-- Shanon Core Tables (PostgreSQL)

-- USERS (Identity)
CREATE TABLE IF NOT EXISTS sys_users (
    rec_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL, -- Logical separation
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user', -- admin, user, developer, superadmin
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- CHANGE REQUESTS (Ticketing System)
CREATE TABLE IF NOT EXISTS sys_change_requests (
    rec_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high
    status VARCHAR(50) DEFAULT 'New', -- New, Analysis, Development, Testing, Done...
    
    assigned_to BIGINT REFERENCES sys_users(rec_id),
    created_by BIGINT REFERENCES sys_users(rec_id),
    
    admin_notes TEXT,
    
    version_id UUID DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DOCUMENT MANAGEMENT (Attachments)
CREATE TABLE IF NOT EXISTS docu_ref (
    rec_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    
    ref_table_id INT NOT NULL, -- e.g. 100 = sys_change_requests
    ref_rec_id BIGINT NOT NULL,
    
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size INT,
    
    created_by BIGINT REFERENCES sys_users(rec_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CHANGE HISTORY LOG
CREATE TABLE IF NOT EXISTS sys_change_history (
    rec_id BIGSERIAL PRIMARY KEY,
    ref_table_id INT NOT NULL,
    ref_rec_id BIGINT NOT NULL,
    
    field_name VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    
    changed_by BIGINT REFERENCES sys_users(rec_id),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_cr_tenant ON sys_change_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_docu_ref ON docu_ref(ref_table_id, ref_rec_id);
-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
