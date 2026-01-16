# STANDARD OPERATING PROCEDURES (SOP) & CHECKLISTS
> **Version**: 2.0 (Updated 2026-01-16)
> **Role**: This document is the MANDATORY Checklist for AI Agents and Developers.
> **Enforcement**: You must complete the relevant checklist before marking any task as "Done".

## A. New Entity / Table Creation
When creating a new database table (Backend):
1.  [ ] **Schema Compliance**: 
    *   Column `rec_id` (SERIAL PK) is present?
    *   Column `tenant_id` (UUID) is present for isolation? (Unless explicitly Global)
    *   Audit columns `created_at`, `created_by`, `updated_at`, `updated_by` are present?
2.  [ ] **Migration**: 
    *   SQL script added to `backend/migrations/XXX_name.sql`?
    *   Registered in `backend/install-db.php` `$migrations` array?
3.  [ ] **Documentation**:
    *   Added table definition to `.agent/DATABASE.md`?

## B. New Form / UI Module
When creating a new Frontend Page/Form:
1.  [ ] **Security Context**:
    *   Registered new ID in `SECURITY.md` (e.g., `form_invoices`)?
    *   Wrapped in `usePermission('form_id', 'view')` check?
2.  [ ] **Standard Components**:
    *   Used `<SmartDataGrid>` for lists?
    *   Used `<PageLayout>` or `<FluentProvider>` correctly?
3.  [ ] **Localization**:
    *   All visible text wrapped in `t('key')`?
    *   Keys added to `cs.json` and `en.json`?
4.  [ ] **UX consistency**:
    *   Contextual Help (InfoLabel) present for complex fields?
    *   Validation feedback implemented (Required fields, types)?

## C. Feature Implementation (Backend API)
When writing PHP API endpoints:
1.  [ ] **Security Barrier**:
    *   `verify_session()` called at the top?
    *   `has_permission()` check performed?
2.  [ ] **Tenant Isolation**:
    *   `WHERE tenant_id = :tid` included in ALL queries?
3.  [ ] **Validation**:
    *   Input data sanitized and validated before DB usage?
4.  [ ] **Error Handling**:
    *   Returns strictly JSON `{"success": false, "error": "..."}` on failure?

## D. Change Management (Commit & Deploy)
1.  [ ] **History Log**: 
    *   Entry added to `development_history` table (via API or SQL)?
2.  [ ] **Code Quality**:
    *   No hardcoded secrets?
    *   No `console.log` or `print_r` left?
3.  [ ] **Testing**:
    *   Does the build pass (`npm run build`)?
    *   **QA Scenario**: Created/Updated test scenario in `.agent/TEST_SCENARIOS.md` for critical features?
    *   Did you verify the fix/feature manually according to the scenario?

---
*Failure to follow these SOPs creates Technical Debt and reduces System Stability.*
