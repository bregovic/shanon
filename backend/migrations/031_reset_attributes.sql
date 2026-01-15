-- 031_reset_attributes.sql
-- Reset and populate default attributes

-- Clear existing (Cascade to clear links)
TRUNCATE TABLE dms_doc_type_attributes CASCADE;
TRUNCATE TABLE dms_attributes CASCADE;

-- Insert new
INSERT INTO dms_attributes (tenant_id, name, code, data_type, is_searchable) VALUES
('00000000-0000-0000-0000-000000000001', 'Dodavatel', 'SUPPLIER', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Datum vystavení', 'ISSUE_DATE', 'date', true),
('00000000-0000-0000-0000-000000000001', 'Číslo faktury', 'INVOICE_NUMBER', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Popis faktury', 'INVOICE_DESCRIPTION', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Nákupní objednávka', 'PURCHASE_ORDER', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Měna', 'CURRENCY', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Celkem k úhradě', 'TOTAL_AMOUNT', 'number', true),
('00000000-0000-0000-0000-000000000001', 'IČO', 'REG_NO', 'text', true),
('00000000-0000-0000-0000-000000000001', 'DIČ', 'VAT_ID', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Datum DUZP', 'TAX_DATE', 'date', true),
('00000000-0000-0000-0000-000000000001', 'Datum splatnosti', 'DUE_DATE', 'date', true),
('00000000-0000-0000-0000-000000000001', 'Datum přijetí', 'RECEPTION_DATE', 'date', true),
('00000000-0000-0000-0000-000000000001', 'Datum zaúčtování', 'POSTING_DATE', 'date', true),
('00000000-0000-0000-0000-000000000001', 'Kód měny', 'CURRENCY_CODE', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Variabilní symbol', 'VARIABLE_SYMBOL', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Bankovní účet', 'BANK_ACCOUNT', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Číslo bankovního účtu', 'BANK_ACCOUNT_NUMBER', 'text', true),
('00000000-0000-0000-0000-000000000001', 'IBAN', 'IBAN', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Kód SWIFT', 'SWIFT', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Konstantní symbol', 'CONSTANT_SYMBOL', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Specifický symbol', 'SPECIFIC_SYMBOL', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Popis položky', 'ITEM_DESCRIPTION', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Množství', 'QUANTITY', 'number', true),
('00000000-0000-0000-0000-000000000001', 'Jednotka', 'UNIT', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Jednotková cena', 'UNIT_PRICE', 'number', true),
('00000000-0000-0000-0000-000000000001', 'Směnný kurz', 'EXCHANGE_RATE', 'number', true),
('00000000-0000-0000-0000-000000000001', 'Adresa', 'ADDRESS', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Telefon', 'PHONE', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Email', 'EMAIL', 'text', true),
('00000000-0000-0000-0000-000000000001', 'Zaokrouhlení', 'ROUNDING', 'number', true),
('00000000-0000-0000-0000-000000000001', 'DPH', 'VAT', 'number', true);
