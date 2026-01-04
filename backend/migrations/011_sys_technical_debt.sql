-- Migration: 011_sys_technical_debt
-- Description: Registry for tracking temporary features, hacks, and technical debt.

CREATE TABLE IF NOT EXISTS sys_technical_debt (
    rec_id SERIAL PRIMARY KEY,
    feature_code VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    author VARCHAR(100),
    status VARCHAR(20) DEFAULT 'Active', -- Active, Resolved
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
