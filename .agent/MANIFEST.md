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
