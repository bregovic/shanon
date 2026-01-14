-- Migration: 029_dms_ocr_templates
-- Description: Infrastructure for Template-based OCR (Zones & Anchors)

DO $$
BEGIN
    -- 1. OCR Templates
    -- Defines a layout recognition pattern (e.g., "Alza Invoice 2024")
    CREATE TABLE IF NOT EXISTS dms_ocr_templates (
        rec_id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL,
        name VARCHAR(100) NOT NULL,
        doc_type_id INT REFERENCES dms_doc_types(rec_id), -- Links layout to logical type (Invoice)
        
        -- Anchors: Text patterns to identify this template automatically
        -- e.g., "DIC: CZ27082440" for Alza
        anchor_text VARCHAR(100),
        
        sample_doc_id INT, -- Link to a DMS document used as the visual master for this template
        
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. OCR Zones
    -- Defines where to look for specific data on the page
    CREATE TABLE IF NOT EXISTS dms_ocr_zones (
        rec_id SERIAL PRIMARY KEY,
        template_id INT NOT NULL REFERENCES dms_ocr_templates(rec_id) ON DELETE CASCADE,
        attribute_code VARCHAR(50) NOT NULL, -- e.g., 'TOTAL_AMOUNT', 'ISSUE_DATE' (Must match dms_attributes)
        
        -- Coordinates in percentage (0.0 to 1.0) relative to page size
        -- This makes it resolution independent
        x FLOAT NOT NULL,
        y FLOAT NOT NULL,
        width FLOAT NOT NULL,
        height FLOAT NOT NULL,
        
        -- Parsing rules
        regex_pattern VARCHAR(255), -- Optional regex to clean the extracted text
        data_type VARCHAR(20) DEFAULT 'text', -- text, number, date, currency
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Log into history
    INSERT INTO development_history (date, title, description, category, created_at)
    SELECT CURRENT_DATE, 'OCR Layout Analysis', 'Added dms_ocr_templates and dms_ocr_zones tables to support coordinate-based data extraction.', 'feature', NOW()
    WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'OCR Layout Analysis' AND date = CURRENT_DATE);

END $$;
