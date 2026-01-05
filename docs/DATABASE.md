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
- `rec_id` (PK)
- `tenant_id`: Multi-tenancy isolation
- `display_name`: User facing filename
- `original_filename`: Original uploaded filename
- `doc_type_id`: FK to `dms_doc_types`
- `storage_profile_id`: FK to `dms_storage_profiles`
- `storage_path`: Relative path or ID within the storage system
- `file_size_bytes`: Size in bytes
- `mime_type`: File MIME type
- `ocr_status`: `pending`, `completed`, `verified`, `skipped`
- `metadata`: JSONB for extracted attributes (`{"attributes": {"INVOICE_NUMBER": "2024001"}}`)
- `created_by`: User ID

### `dms_file_contents`
Blob storage for files (used when local/cloud storage is not available or for caching).
- `doc_id` (PK, FK): References `dms_documents`
- `content`: Binary data (BYTEA)

### `dms_doc_types`
Categorization for documents.
- `rec_id` (PK)
- `tenant_id`: Multi-tenancy isolation
- `code`: System identifier (e.g. `INV_IN`)
- `name`: Human-readable name
- `icon`: FluentUI icon name
- `number_series_id`: FK to `sys_number_series`
- `description`: Optional description

### `dms_attributes`
Defines attributes that should be extracted from documents (OCR) or manually entered.
- `rec_id` (PK)
- `tenant_id`: Multi-tenancy isolation
- `name`: Display name (e.g. "Číslo faktury")
- `code`: System code for OCR mapping (e.g. `INVOICE_NUMBER`)
- `data_type`: `text`, `number`, `date`, `boolean`
- `is_required`: Validated on save
- `is_searchable`: Included in fulltext search
- `default_value`: Pre-filled value
- `help_text`: User hint

### `dms_storage_profiles`
Configuration for where documents are physically stored.
- `rec_id` (PK)
- `tenant_id`: Multi-tenancy isolation
- `name`: Profile name (e.g. "Google Drive Finance")
- `storage_type`: `local`, `google_drive` ...
- `base_path`: Root folder path or ID
- `connection_string`: Credentials or configuration JSON (Encrypted/TEXT)
- `is_default`: Auto-selected for new uploads
- `is_active`: Enabled/Disabled

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

## Change Requests (Helpdesk)

### `sys_change_requests`
Primary table for tracking issues and feature requests.
- `rec_id` (PK)
- `tenant_id`: Multi-tenancy isolation
- `subject`: Ticket title
- `status`: `New`, `Pending`, `Testing`, `Done`
- `priority`: `low`, `medium`, `high`
- `assigned_to`: User ID

### `sys_change_comments`
Discussion threads for requests.
- `rec_id` (PK)
- `cr_id`: FK to `sys_change_requests`
- `user_id`: FK to `sys_users`
- `comment`: Text content

### `sys_technical_debt`
Registry for temporary features and hacks.
- `feature_code`: Unique ID
- `description`: Why it exists
- `status`: Active/Resolved

## Migrations
Migrations are handled by `install-db.php`.
Current HEAD: `012_history_catchup` (log missing history)
