-- Migration: 012_history_catchup
-- Description: Backfill missing history entries for recent features

INSERT INTO development_history (date, title, description, category, created_at)
SELECT '2026-01-04', 'Comments System', 'Implementace systému komentářů pro požadavky (Change Requests). Migrace databáze a sjednocení API.', 'Feature', NOW()
WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Comments System');

INSERT INTO development_history (date, title, description, category, created_at)
SELECT '2026-01-04', 'Technical Debt Registry', 'Zavedení systémové evidence technického dluhu a dočasných funkcí (Manifest compliance).', 'Feature', NOW()
WHERE NOT EXISTS (SELECT 1 FROM development_history WHERE title = 'Technical Debt Registry');
