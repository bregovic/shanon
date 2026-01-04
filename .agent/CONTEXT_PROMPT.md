# SHANON SYSTEM: MASTER CONTEXT & PROTOCOLS
> **CRITICAL INSTRUCTION:** This is the Single Source of Truth for the Shanon Project. All Agents must adhere to the rules and documentation linked herein. Deviations are creating Technical Debt.

## 1. DOCUMENTATION INDEX (Knowledge Base)
Before modifying any part of the system, you MUST read the relevant documentation:

*   📘 **Process & Workflow:** `docs/AGENT_WORKFLOW.md`
    *   *Rules for:* Ticket Lifecycle, Signature protocol, Development History logging, Comment marking.
*   💾 **Database & Objects:** `.agent/DATABASE.md`
    *   *Rules for:* Schema structure, Migration flow (`install-db.php`), Tenant isolation.
*   🔒 **Security & RBAC:** `.agent/SECURITY.md`
    *   *Rules for:* Roles, Permissions, Auth tokens, Visibility rules.
*   🏗️ **Code & Frameworks:** `.agent/MANIFEST.md`
    *   *Rules for:* Tech stack (Fluent UI v9, PHP), Directory structure, Naming conventions.
*   ✅ **Checklists (SOP):** `.agent/SOP.md`
    *   *Use for:* Self-validation before finalizing any task.

---

## 2. CORE PROTOCOLS (Strict)

### A. Database Management
*   **Migrations:** NEVER create tables on the fly. ALWAYS use `backend/migrations/XXX_name.sql` and register in `backend/install-db.php`.
*   **Documentation:** Immediately update `.agent/DATABASE.md` after any schema change.
*   **Isolation:** EVERY query must include `WHERE tenant_id = :tid` (unless strictly System Global).

### B. Security & Access
*   **Session:** Use `session_init.php` (DB-backed sessions).
*   **RBAC:** Check permissions against the User Role defined in `SECURITY.md` before rendering UI elements.

### C. Localization & Labels
*   **No Hardcoding:** All visible text must go through `useTranslation()` (Frontend) or `api-translations.php` (Backend).
*   **Format:** Use keys like `common.save`, `module.requests.title`.
*   **Languages:** Maintain at least `cs` (Czech) and `en` (English).

### D. Development History & Reporting
*   **Identity:** Always perform database actions (comments, history logs) as the `AI Developer` user (email: `ai@shanon.dev`). Do NOT use ID 1 (Super Admin).
*   **Logging:** Every resolved ticket MUST have an entry in the `development_history` table (via `api-dev-history.php` or direct SQL).
*   **Signatures:** All automated/agent comments must be signed (e.g., `~ 🤖 Antigravity`).
*   **Status:** Move tickets from `New` -> `Development` -> `Testing` -> `Done`.

### E. Working Files System (External Development)
*   **Structure:** `External Development/For Development/[TICKET_ID]_[DESCRIPTION]/`
*   **Logic:**
    *   Physical files are bound to Digital Tickets via ID (e.g., `#7`).
    *   **Input:** Files placed in folder -> Developer works.
    *   **Output:** Developer commits code -> Ticket updated -> Deployment.

---

## 3. TECH STACK SUMMARY
*   **Frontend:** React 18, TypeScript, **Fluent UI v9** (Strict Design System).
*   **Backend:** PHP 8.3, PostgreSQL 16 (via PDO), Stateless REST API rules.
*   **Environment:** Railway (Dockerized).

> **FINAL CHECK:** Have you signed your comment? Have you updated the status? Have you logged the history? If not, do it now.
