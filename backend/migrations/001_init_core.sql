-- 001_init_core.sql
-- Shanon Core Tables (PostgreSQL)

-- Enable UUID extension first
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS (Identity)
CREATE TABLE IF NOT EXISTS sys_users (
    rec_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL, 
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user', 
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- ROLES & SECURITY
CREATE TABLE IF NOT EXISTS sys_roles (
    role_id VARCHAR(50) PRIMARY KEY,
    label VARCHAR(100)
);
INSERT INTO sys_roles (role_id, label) VALUES 
('admin', 'Administrátor'),
('user', 'Uživatel'),
('manager', 'Manažer'),
('developer', 'Vývojář'),
('superadmin', 'Super Admin')
ON CONFLICT DO NOTHING;

-- CHANGE REQUESTS (Ticketing System)
CREATE TABLE IF NOT EXISTS sys_change_requests (
    rec_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'medium', 
    status VARCHAR(50) DEFAULT 'New', 
    
    assigned_to BIGINT REFERENCES sys_users(rec_id),
    created_by BIGINT REFERENCES sys_users(rec_id),
    
    admin_notes TEXT,
    
    version_id UUID DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- WORKFLOW ENGINE
CREATE TABLE IF NOT EXISTS sys_workflow_status (
    workflow_id VARCHAR(50),
    status_id VARCHAR(50),
    label VARCHAR(100),
    is_initial BOOLEAN DEFAULT FALSE,
    is_final BOOLEAN DEFAULT FALSE,
    color VARCHAR(20) DEFAULT 'neutral', -- success, warning, danger, neutral
    PRIMARY KEY (workflow_id, status_id)
);

CREATE TABLE IF NOT EXISTS sys_workflow_transitions (
    rec_id BIGSERIAL PRIMARY KEY,
    workflow_id VARCHAR(50),
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    button_label VARCHAR(100),
    required_role VARCHAR(50),
    FOREIGN KEY (workflow_id, from_status) REFERENCES sys_workflow_status(workflow_id, status_id),
    FOREIGN KEY (workflow_id, to_status) REFERENCES sys_workflow_status(workflow_id, status_id)
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
