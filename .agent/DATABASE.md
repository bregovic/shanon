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

### `sys_organizations`
Multi-Organization (Company/Legal Entity) registry. Implements D365-style DataAreaId concept.
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `org_id` | CHAR(5) (PK) | No | Organization Code (e.g., `VACKR`) |
| `tenant_id` | UUID | No | Tenant isolation key |
| `display_name` | VARCHAR(100) | No | Full name (e.g., "Bc. Václav Král") |
| `address` | TEXT | Yes | Registered address |
| `reg_no` | VARCHAR(20) | Yes | Registration Number (IČO) |
| `tax_no` | VARCHAR(20) | Yes | Tax ID (DIČ) |
| `is_active` | BOOLEAN | No | Soft delete (Default: true) |
| `created_at` | TIMESTAMP | No | Creation timestamp |
| `updated_at` | TIMESTAMP | No | Last update timestamp |

### `sys_user_org_access`
Links users to organizations they can access.
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `user_id` | INT (FK) | No | Reference to `sys_users.rec_id` |
| `org_id` | CHAR(5) (FK) | No | Reference to `sys_organizations.org_id` |
| `is_default` | BOOLEAN | No | User's default organization (Default: false) |
| `assigned_at` | TIMESTAMP | No | When access was granted |
| **PK** | `(user_id, org_id)` | | Composite primary key |

**Note:** Users with `ADMIN` role can access ALL active organizations regardless of entries in this table.

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

### `sys_change_comment_reactions`
Reactions to comments (e.g. Likes, Checks).
| Column | Type | Description |
| :--- | :--- | :--- |
| `rec_id` | SERIAL (PK) | ID |
| `comment_id` | INT (FK) | Link to `sys_change_comments` |
| `user_id` | INT (FK) | User who reacted |
| `reaction_type` | VARCHAR(50) | `smile`, `check`, `cross`, `heart` |


---

## 3. Document Management (DMS)

### `dms_documents`
The header table for all stored files.
| Column | Type | Description |
| :--- | :--- | :--- |
| `rec_id` | SERIAL (PK) | Document ID |
| `org_id` | CHAR(5) (FK) | Organization scope (Multi-Org isolation) |
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

---

## 5. Security Governance (RBAC)

### `sys_security_objects`
Registry of all securable system elements (Modules, Forms, Actions).
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `rec_id` | SERIAL (PK) | No | ID |
| `identifier` | VARCHAR(100) | No | Unique technical ID (e.g., `mod_crm`) |
| `type` | VARCHAR(20) | No | `module`, `form`, `action` |
| `display_name` | VARCHAR(100) | No | Readable name |
| `description` | TEXT | Yes | Usage details |

### `sys_security_roles`
Definition of system roles.
| Column | Type | Description |
| :--- | :--- | :--- |
| `rec_id` | SERIAL (PK) | Role ID |
| `code` | VARCHAR(50) | Unique Code (e.g., `ADMIN`, `MANAGER`) |
| `description` | TEXT | Details |

### `sys_security_permissions`
Mapping of Access Levels.
| Column | Type | Description |
| :--- | :--- | :--- |
| `role_id` | INT (FK) | Reference to Role |
| `object_id` | INT (FK) | Reference to Object |
| `access_level` | INT | `0`=None, `1`=View, `2`=Edit, `3`=Full |

### `sys_user_roles`
Assignment of roles to users (Migration target from JSON).
| Column | Type | Description |
| :--- | :--- | :--- |
| `user_id` | INT (FK) | Reference to User |
| `role_id` | INT (FK) | Reference to Role |

