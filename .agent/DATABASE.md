# Shanon Database Schema & Documentation
> Version: 1.0.0
> Last Updated: 2026-01-04

## 1. System Core (Identity & Infrastructure)

### `sys_users`
Central user registry (Identity).
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `rec_id` | SERIAL (PK) | No | Unique User ID |
| `tenant_id` | UUID | No | Multi-tenancy isolation key |
| `username` | VARCHAR(50) | No | Login identifier |
| `full_name` | VARCHAR(100)| No | Display name |
| `email` | VARCHAR(100)| Yes | Notification address |
| `roles` | JSON | No | Array of roles e.g. `["admin", "dms_user"]` |
| `is_active` | BOOLEAN | No | Soft delete status (Default: true) |

### `sys_sessions`
Persistent PHP sessions storage (via `DbSessionHandler`).
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | VARCHAR(128) (PK) | Session Key |
| `data` | TEXT | Serialized PHP session payload |
| `access` | INT | Timestamp of last activity |

### `sys_number_series` (Global)
Centralized ID generation service.
| Column | Type | Description |
| :--- | :--- | :--- |
| `code` | VARCHAR(50) (Unique) | Series Identifier (e.g. `REQ`, `INV_2026`) |
| `format_mask`| VARCHAR(50) | Parsing mask: `{YYYY}`, `{MM}`, `{00000}` |
| `last_number`| INT | The counter value |
| `reset_period`| VARCHAR(20)| `never`, `year`, `month` |

---

## 2. Change Management & Development

### `sys_change_requests`
Main table for internal feedback, bugs, and feature requests.
| Column | Type | Description |
| :--- | :--- | :--- |
| `rec_id` | SERIAL (PK) | Ticket ID |
| `subject` | VARCHAR(200)| Title |
| `description`| TEXT | Rich text description |
| `priority` | VARCHAR(20) | `low`, `medium`, `high` |
| `status` | VARCHAR(20) | `New`, `In Progress`, `Done`, `Rejected` |
| `created_by` | INT (FK) | User who reported |
| `assigned_to`| INT (FK) | Developer/Agent assigned |

### `sys_change_requests_files`
Attachments for requests.
| Column | Type | Description |
| :--- | :--- | :--- |
| `cr_id` | INT (FK) | Link to Request |
| `file_data` | TEXT | Base64 encoded content (Current implementation) |

### `development_history`
Public-facing changelog / release notes.
| Column | Type | Description |
| :--- | :--- | :--- |
| `date` | DATE | Release date |
| `title` | VARCHAR(200)| Headline |
| `category` | VARCHAR(50) | `feature`, `bugfix`, `refactor`, `improvement`, `deploy` |
| `related_task_id`| INT | Link to `sys_change_requests` (Optional) |

---

## 3. Document Management (DMS)

### `dms_documents`
The header table for all stored files.
| Column | Type | Description |
| :--- | :--- | :--- |
| `rec_id` | SERIAL (PK) | Document ID |
| `doc_type_id`| INT (FK) | Link to `dms_doc_types` |
| `display_name`| VARCHAR | User facing filename |
| `ocr_status` | VARCHAR(20) | `pending`, `processing`, `done` |
| `ocr_content`| TEXT | Extracted full-text |
| `metadata` | JSONB | Dynamic attributes (e.g., `invoice_date`, `vat_id`) |

### `dms_doc_types`
Configuration of document categories.
| Column | Type | Description |
| :--- | :--- | :--- |
| `code` | VARCHAR(50) | Unique Code (e.g. `INV_IN`) |
| `icon` | VARCHAR(50) | UI Icon name |

---

## 4. Standard Enums (Lists of Values)

**Priorities:**
*   `low`
*   `medium`
*   `high`
*   `critical`

**Development Categories:**
*   `feature` (New functionality)
*   `bugfix` (Correction of error)
*   `refactor` (Code cleanup, no logic change)
*   `improvement` (UX/Performance enhancement)
*   `deploy` (System update)
