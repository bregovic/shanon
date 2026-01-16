# SHANON SYSTEM: MASTER CONTEXT & PROTOCOLS
> **CRITICAL INSTRUCTION:** This is the Single Source of Truth for the Shanon Project. All Agents must adhere to the rules and documentation linked herein. Deviations are creating Technical Debt.

## 1. DOCUMENTATION INDEX (Knowledge Base)
**You are required to consult these files for specific implementation details:**

*   📘 **FORM & UI STANDARD:** `.agent/FORM_STANDARD.md`
    *   *Rules for:* Creating new forms, RLS (Record Level Security), Layouts, Grids.
*   ✅ **SOP CHECKLISTS:** `.agent/SOP.md`
    *   *Rules for:* Pre-commit checks, Database changes, Security compliance.
*   💾 **DATABASE SCHEMA:** `.agent/DATABASE.md`
    *   *Rules for:* Current tables, columns, relationships.
*   🔒 **SECURITY REGISTRY:** `.agent/SECURITY.md`
    *   *Rules for:* Role definitions, Access Levels, Permission Identifiers.
*   🏗️ **TECH MANIFEST:** `.agent/MANIFEST.md`
    *   *Rules for:* Framework usage, Directory structure, Localization.

---

## 2. CORE SYSTEM PRINCIPLES

### A. Strict Multi-Tenancy & Global Organization Context
*   **Database:** Every transactional table MUST have `tenant_id` AND `org_id`. Configuration tables must have `tenant_id`.
*   **Security Context:**
    *   **Backend:** NEVER trust default behavior. Every SQL update/select must explicitly enforce `WHERE tenant_id = :tid AND org_id = :oid` (unless global lookup).
    *   **Frontend:** Every form/list MUST respect the current Organization Context (`useAuth().currentOrgId`).
    *   **Validation:** Verify that the `rec_id` being accessed truly belongs to the requested `tenant_id` + `org_id`.

### B. "Enterprise" User Experience & Mobile Optimization
*   **Mobile Priority:**
    *   All layouts must be responsive. Grid columns must collapse or hide on small screens.
    *   **NO Horizontal Scrolling** on mobile for main content forms.
    *   Buttons must have adequate touch targets (min 44px height implication).
*   **Translation & Labels (Label Optimization):**
    *   **Reuse First:** Before creating a new translation key, check `common.json`. Use `common.save`, `common.cancel`, `common.name` instead of `module.save_button`.
    *   **No Hardcoding:** Never output raw text strings in components. Always use `t('key')`.
*   **Modular Forms:**
    *   Design forms as composable **Cards/Sections** (e.g., `<GeneralInfo />`, `<ContactDetails />`).
    *   This enables future reordering of form parts without rewriting logic.

### C. Performance & Technical Best Practices
*   **Database:**
    *   Avoid `SELECT *` on tables with many columns. Select only what you need.
    *   Ensure Foreign Keys are indexed.
*   **Session Management:**
    *   Use `session_write_close()` immediately in PHP read-only endpoints to prevent session locking.
*   **ID Mapping:**
    *   **Internal:** Use `rec_id` (int) or `id` (uuid) for code logic.
    *   **External:** Display friendly codes (e.g., `DOC-2024-001`) to users.
    *   **API:** APIs should accept `rec_id` but validate it strongly.

### D. Documentation & History
*   **Self-Documenting:** Code must generally explain itself, but complex logic needs comments.
*   **Changelog:** Every resolved task MUST be logged in the `development_history` table.

---

## 3. HOW TO START A TASK
1.  **Read Context:** Check usage in `FORM_STANDARD.md` or `DATABASE.md`.
2.  **Implementation:** Write code following the `SOP.md` checklist and Principles above.
3.  **Verification:** Build `npm run build` and check for lint errors.
4.  **Finalization:** Log change in History and sign off.

## 6. Data Seeding & Default Values
- **Objective**: Maintain a library of default parametric data (Code Lists) that can be injected into any Organization/Tenant.
- **File Location**: `backend/helpers/DataSeeder.php`.
- **Rule**: Whenever you create a new configuration table (e.g., `dms_doc_types`, `sys_currencies`, `tax_rates`), you MUST add a corresponding method to `DataSeeder.php` that defines the standard/default values (e.g., `seedDocTypes`, `seedCurrencies`).
- **Usage**: These seeders are exposed via `api-system.php` -> `action=run_seeders` and are available in the System Administration UI for bulk initialization.
