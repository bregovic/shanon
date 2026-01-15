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

### A. Strict Multi-Tenancy
*   **Database:** Almost every table MUST have a `tenant_id` column.
*   **Querying:** Never trust client IDs blindy. Always append `AND tenant_id = :current_tenant_id` to WHERE clauses.
*   **Context:** use `useAuth().currentOrgId` on the frontend.

### B. Security First
*   **Frontend:** Every Page/Action must check `hasPermission(object, level)`.
*   **Backend:** APIs must verify `verify_session()` AND specific permission for the action.
*   **Records:** Implement RLS (Record Level Security) where appropriate (Users see only their own data if not Manager).

### C. "Enterprise" User Experience
*   **Reactivity:** Actions (Save/Delete) must reflect immediately in lists (Optimistic UI or Refetch).
*   **Consistency:** Use standard `SmartDataGrid` for all tables.
*   **Help:** Provide inline help (Info/Tooltip) for business logic fields.

### D. Documentation & History
*   **Self-Documenting:** Code must generally explain itself, but complex logic needs comments.
*   **Changelog:** Every resolved task MUST be logged in the `development_history` table.

---

## 3. HOW TO START A TASK
1.  **Read Context:** Check usage in `FORM_STANDARD.md` or `DATABASE.md`.
2.  **Implementation:** Write code following the `SOP.md` checklist.
3.  **Verification:** Build `npm run build` and check for lint errors.
4.  **Finalization:** Log change in History and sign off.
