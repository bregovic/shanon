CREATE TABLE IF NOT EXISTS sys_help_pages (
    id SERIAL PRIMARY KEY,
    topic_key VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    module VARCHAR(50),
    content TEXT NOT NULL,
    keywords TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_help_search ON sys_help_pages(title, keywords);
CREATE INDEX idx_help_module ON sys_help_pages(module);
