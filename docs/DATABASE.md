# Database Schema Documentation
*Generated: 2026-01-04*

## Core Tables

### `sys_sessions`
Stores user session data.
- `id` (PK): Session Identifier
- `data`: Serialized session payload
- `access`: Timestamp

### `sys_number_series`
Manages auto-incrementing sequences for documents (Factors, Contracts, etc.).
- `code` (Unique): Series code (e.g. `INV_2026`)
- `format_mask`: Pattern
- `last_number`: Current counter

### `development_history`
Tracks the changelog of the application visible in the UI.
- `date`: Date of change
- `title`: Short summary
- `description`: Detailed description
- `category`: `feature` | `bugfix` | `refactor`

## DMS (Document Management)

### `dms_documents`
Primary file storage metadata.
- `file_path`: Relative path to storage
- `display_name`: User facing filename
- `metadata`: JSONB for custom fields

### `dms_doc_types`
Categorization for documents.
- `code`: System identifier (e.g. `INV_IN`)
- `icon`: FluentUI icon name

## Security & RBAC

### `sys_security_roles`
Role definitions for access control.
- `code`: Unique role identifier (`ADMIN`, `MANAGER`, `USER`, `GUEST`)
- `description`: Human-readable description

### `sys_security_objects`
Registry of securable objects (modules, forms, actions).
- `identifier`: System identifier (e.g., `mod_dms`, `form_security_roles`)
- `type`: Object type (`module`, `form`, `action`)
- `display_name`: User-facing name

### `sys_security_permissions`
Mapping between Roles and Objects.
- `role_id`: FK to `sys_security_roles`
- `object_id`: FK to `sys_security_objects`
- `access_level`: 0=None, 1=View, 2=Edit, 3=Full

### `sys_user_roles`
User-to-role assignments.
- `user_id`: Reference to user
- `role_id`: FK to `sys_security_roles`

## Migrations
Migrations are handled by `install-db.php`.
Current HEAD: `008_history_20260104` (includes RBAC Security)
