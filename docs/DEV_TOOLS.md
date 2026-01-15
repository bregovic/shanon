# Developer Tools & Helper Scripts

Tento dokument slouží k evidenci pomocných skriptů v `backend/` složce.
**Důležité:** Skripty označené jako `[TEMP]` nebo `[UNSAFE]` by neměly zůstávat na produkci trvale, nebo musí být chráněny.

## Diagnostika a Debugging (Safe / Read-only)
- `test-health.php`: Jednoduchý check, zda běží PHP a DB.
- `diag.php`, `diag2.php`: Diagnostika server environmentu (ENV proměnné, cesty).
- `debug_api.php`: Testování API endpointů.
- `version_check.php`: Vypíše verzi aplikace.

## Data Fixes & Migrace (Jednorázové)
- `install-db.php`: Hlavní migrační skript (chráněn tokenem).
- `fix_*.php` (např. `fix_barrick.php`, `fix_user_ids.php`): Jednorázové opravy dat. **Kandidáti na smazání.**
- `migrate_db*.php`: Starší migrační skripty.
- `cleanup_*.php`: Skripty na čištění dat.

## Nebezpečné / Debug Skripty (K smazání po použití!)
- `debug_dms_error.php`: [UNSAFE] Vypisuje strukturu tabulek a data bez autorizace. **SMAZAT IHNED po vyřešení DMS 500.**
- `debug_market.php`: Debug tržních dat.
- `debug-prices.php`: Debug cen.

## Ostatní
- `googlefinanceservice.php`: Legacy/Alternative service?
- `cors.php`: Nastavení CORS hlaviček (Core).
- `db.php`: Připojení k DB (Core).
