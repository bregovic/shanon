-- Migration: 014_sys_comment_reactions
-- Description: Create reactions table for comments

CREATE TABLE IF NOT EXISTS sys_change_comment_reactions (
    rec_id SERIAL PRIMARY KEY,
    comment_id INT NOT NULL,
    user_id INT NOT NULL,
    reaction_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comm_react_comm FOREIGN KEY (comment_id) REFERENCES sys_change_comments(rec_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_react_uniq ON sys_change_comment_reactions(comment_id, user_id, reaction_type);
