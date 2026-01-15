# FORM & UI IMPLEMENTATION STANDARD
> **Purpose:** This document defines the "Gold Standard" for creating User Interfaces in the Shanon system.
> **Goal:** Consistency, Security, and Maintainability across all modules.

## 1. Anatomy of a Standard Page
Every standard management page (e.g., `InvoicesPage.tsx`) should follow this structure:

```tsx
export const MyModulePage = () => {
    // 1. Hooks & Context
    const { t } = useTranslation();
    const { hasPermission } = usePermission();
    const { currentOrgId } = useAuth();
    
    // 2. Security Gate
    if (!hasPermission('mod_mymodule', 'view')) return <AccessDenied />;

    // 3. State
    const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

    // 4. Layout
    return (
        <PageLayout
            title={t('mymodule.title')}
            actions={<MyActions />}
        >
             {viewMode === 'list' ? <MyList /> : <MyDetail />}
        </PageLayout>
    );
};
```

## 2. SmartDataGrid Standard
The `SmartDataGrid` is the core component for lists.
*   **Persisted State:** Future: Grid should save column width/order to user settings.
*   **Filters:** Use the built-in header filters.
*   **Actions:** Use a context menu or right-side action column for row operations.

## 3. Record Level Security (RLS) & Multi-Tenancy
*   **Frontend Filter:** While the backend enforces security, the frontend should generally pre-filter.
    *   *Example:* If user is `Role.USER`, default the "Owner" filter to "Me".
*   **Backend Queries:**
    ```php
    $sql = "SELECT * FROM my_table WHERE tenant_id = :tid";
    if ($user_role === 'USER') {
        $sql .= " AND owner_id = :uid";
    }
    ```

## 4. Forms & Inputs
*   **Validation:** Use client-side validation for immediate feedback (Required, Format).
*   **Context Help:**
    *   Every non-obvious field MUST have an `InfoLabel` or Tooltip.
    *   *Example:* "Tax Code (Select the default VAT rate for this item)" vs just "Tax Code".
*   **Attachments:**
    *   Do NOT build custom uploaders.
    *   Use the standard `AttachmentManager` component (linked to `dms_documents`).

## 5. Attributes & Personalization
*   **Custom Fields:** If an entity supports dynamic attributes (via `sys_attributes`), render them in a dedicated "Attributes" tab in the Detail view.
*   **Defaults:** Pre-fill commonly used fields (e.g., Date = Today, Owner = Current User).

## 6. Error Handling & Feedback
*   **Success:** Show a temporary `Toast` / `MessageBar` ("Saved successfully").
*   **Error:** Show a persistent `Alert` ("Failed to save: Duplicate code").
*   **Loading:** Always show `Spinner` or Skeleton loader during fetch.
