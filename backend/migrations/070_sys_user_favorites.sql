CREATE TABLE IF NOT EXISTS sys_user_favorites (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    path VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    module VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_user_favorite_path UNIQUE (user_id, path)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON sys_user_favorites(user_id);
