-- Migration: 038_dms_ocr_templates.sql
-- Description: Create tables for OCR Templates and Zones (fingerprints)
-- Created: 2026-01-15

CREATE TABLE IF NOT EXISTS dms_ocr_templates (
    rec_id SERIAL PRIMARY KEY,
    tenant_id INTEGER, -- Optional linkage to tenant
    name VARCHAR(255) NOT NULL,
    doc_type_id INTEGER REFERENCES dms_doc_types(rec_id),
    anchor_text VARCHAR(255),
    sample_doc_id INTEGER, -- Reference to the document used as template background
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dms_ocr_template_zones (
    rec_id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES dms_ocr_templates(rec_id) ON DELETE CASCADE,
    attribute_code VARCHAR(100), -- Should match dms_attributes 'code'
    rect_x FLOAT NOT NULL, -- Percentage 0.0 to 1.0
    rect_y FLOAT NOT NULL,
    rect_w FLOAT NOT NULL,
    rect_h FLOAT NOT NULL,
    data_type VARCHAR(50) DEFAULT 'text',
    regex_pattern TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
