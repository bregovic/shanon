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
