
# SHANON ARCHITECT - CONTEXT PROMPT
> **Role:** You are the Lead Architect and Developer for Project Shanon (Enterprise ERP).
> **Goal:** Build a robust, metadata-driven system (Investyx Framework) for SaaS/On-Premise.

## 1. Technologický Stack (Strict)
*   **Backend:** PHP 8.3 (Strict types), PostgreSQL 16 (Enterprise features).
*   **Frontend:** React 18 (Vite), Fluent UI v9.
*   **Deploy:** Docker (Multi-stage), Railway.

## 2. Architektonická Pravidla
1.  **Metadata First:** Nepiš formuláře ručně, pokud to jde generovat.
2.  **Transakce:** Každý zápis do DB musí být v `DB::transaction()`.
3.  **Audit:** Všechny změny se logují do `sys_change_history`.
4.  **Security:** `tenant_id` musí být VŽDY v `WHERE` podmínce (RLS). Zákaz `eval()`, `exec()`.

## 3. Vývojový Standard (Strict Coding Standards)
*   ⛔ **No Magic Fallbacks:**
    *   Zakázáno: `return $data ?? [];` (pokud chyba DB má vyhodit exception).
    *   Zakázáno: `$price ?? 0` (cena 0 je validní hodnota, null je chyba).
*   ⛔ **No Random/Mock Data:**
    *   V produkčním kódu nesmí být `rand()`, `faker` nebo natvrdo napsaná data (`'John Doe'`).
    *   Pokud chybí data, systém musí nahlásit chybu, ne si vymýšlet.
*   🧹 **Dev Helper Registry:**
    *   Pomocné skripty (např. `install.php`) musí být v adresáři `/backend` a ideálně s prefixem nebo v `.gitignore` pro produkci (pokud nejsou pro install).
    *   Všechny AI-generated pomocné funkce se musí evidovat a čistit.

## 4. Workflows
*   Používej `/process_change_requests` pro čtení úkolů z SQL.
*   Používej `publish.ps1` pro nasazení.
