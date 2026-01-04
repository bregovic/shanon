# SHANON Development Manifest

## 1. Database Migrations
**Rule:** Ensure all database schema changes are reversible (where possible) and consolidated.
*   **Do not create**: Multiple `install-xyz.php` scripts.
*   **Do use**: The unified migration runner `backend/install-db.php`.
*   **Workflow**: Add new SQL changes as a new entry in the `$migrations` array in `install-db.php` with a sequential prefix or clear name.

## 2. Session Management
**Rule:** Use database persistence for sessions to support cloud environments.
*   Sessions are stored in `sys_sessions` table (PostgreSQL).
*   Session configuration must handle Cross-Origin (SameSite=None, Secure).
*   Always use `session_init.php` which implements `DbSessionHandler`.

## 3. UI/UX Standards
**Rule:** Follow the Premium "Investyx/D365" Aesthetic.
*   **Framework**: Fluent UI v9 via `@fluentui/react-components`.
*   **Components**: 
    *   **DataGrid**: MUST use inline header filters (popover style), not external search bars.
    *   **Forms**: Use Fluent UI controls.
*   **Design**: Clean, professional, "Enterprise-grade".

## 4. Environment
*   **Backend**: Pure PHP API (`/api/`).
*   **Frontend**: Vite + React + TypeScript.
*   **Deploy**: Railway (Dockerized).

## 5. System Configuration Modules
**Rule:** Administration modules must be structured for high scalability.
*   **Layout**: Use Tab/Section based layouts (e.g., `TabList`) to categorize functionality (Diagnostics, Settings, Logs).
*   **Diagnostics**: All critical sub-systems (DB, Session, Mail) must have a visual health check.
*   **Debug**: Debug tools must be secured or token-protected.

## 6. Automation & Tasks
**Rule:** Tasks are treated as System Functions (Batch Jobs), not just To-Do items.
*   **Definition**: A "Task" (Úloha) represents an executable unit of work (e.g., "Process Pending Emails", "OCR Scan Batch").
*   **Execution**: Designed to be triggered periodically (Cron) or manually by Admin.
*   **Structure**: Should separate the *definition* of the task from its *execution history*.

## 7. Localization & Labels
**Rule:** NO hardcoded strings. Maximize label reuse.
*   **Mechanism**: Use `useTranslation()` context on frontend and `api-translations.php` on backend.
*   **Reuse Strategy**: 
    *   ALWAYS check `common.*` keys first.
    *   Use Global Enums/LOVs (`status.active`, `bool.yes`).
*   **Completeness**: When adding a new feature, updated both `cs.json` and `en.json`.
*   **Default**: Default language is English.

## 8. External Development Workflow
**Rule:** All external tasks must be tracked via internal "Requests" (Požadavky) module.
*   **Process**:
    1.  Create Ticket in "Requests" (Category: Development).
    2.  Lead Agent creates folder in `External Development/For Development`.
    3.  **Naming Convention**: Folder MUST start with Ticket ID (e.g., `REQ-105_DMS_OCR`).
    4.  The Ticket ID binds the digital record to the physical file package.
*   **Synchronization**:
    *   Ticket `In Progress` = Folder provided to external agent.
    *   Ticket `Review` = Result returned to `Deployment` folder.
    *   Ticket `Done` = Code merged into main codebase.

## 9. Number Series (Identification)
**Rule:** Use Centralized Number Series.
*   **Table**: `sys_number_series`.
*   **Mechanism**: Modules should request next specific number via System Service (Backend helper), not implement own counters.
*   **Format**: Support masks like `INV-{YYYY}-{00000}`.

## 10. Documentation
**Rule:** Maintain schema documentation in `.agent/DATABASE.md`.
*   **Source of Truth:** The `DATABASE.md` file reflects the current production schema.
*   **Updates:** When `install-db.php` is modified, update `DATABASE.md` immediately.

## 11. Security Governance (RBAC)
**Rule:** Strict adherence to Role-Based Access Control define in `.agent/SECURITY.md`.
*   **Source of Truth:** `.agent/SECURITY.md` defines all Roles, Security Identifiers (Modules, Forms, Actions), and Access Levels.
*   **Registry Check:** Before creating any new UI element or Module, verify or register its `identifier` in `SECURITY.md`.
*   **Context:** AI Assistants must check permissions logic when generating UI components.

