-- Migration: 010_sys_change_comments
-- Description: Create comments table for change requests

CREATE TABLE IF NOT EXISTS sys_change_comments (
    rec_id SERIAL PRIMARY KEY,
    cr_id INT NOT NULL,
    user_id INT NOT NULL,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comments_cr ON sys_change_comments(cr_id);

-- Safely add FK using anonymous block (Postgres specific)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_comments_cr') THEN
        ALTER TABLE sys_change_comments 
        ADD CONSTRAINT fk_comments_cr 
        FOREIGN KEY (cr_id) REFERENCES sys_change_requests(rec_id) ON DELETE CASCADE;
    END IF;
END $$;
