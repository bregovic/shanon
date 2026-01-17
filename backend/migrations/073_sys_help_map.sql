CREATE TABLE IF NOT EXISTS sys_help_context_mapping (
    id SERIAL PRIMARY KEY,
    path_pattern VARCHAR(255) NOT NULL, -- e.g. 'system/users', 'dms/*'
    topic_key VARCHAR(100) NOT NULL,    -- Foreign key to sys_help_pages.topic_key
    priority INT DEFAULT 0,             -- Higher number = higher priority
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_help_mapping_path UNIQUE (path_pattern)
);

CREATE INDEX IF NOT EXISTS idx_help_map_path ON sys_help_context_mapping(path_pattern);

-- Initial Seed
INSERT INTO sys_help_context_mapping (path_pattern, topic_key, priority) VALUES 
('dashboard', 'intro.dashboard', 0),
('system/users', 'admin.users', 10),
('system/*', 'admin.general', 0),
('dms/*', 'dms.general', 0)
ON CONFLICT (path_pattern) DO NOTHING;
