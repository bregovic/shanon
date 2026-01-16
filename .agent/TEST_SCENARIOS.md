# QA TEST SCENARIOS

## 1. Identity & Security Management (User-Org-Role)
**Target:** Validate that users can be assigned to multiple organizations with specific roles and that context switching works.

### Scenario A: Assign Organization and Role to User
*   **Prerequisites:** Logged in as `Super Admin`. A secondary test user exists (e.g., `test@shanon.cz` with no access). Organization `VACKR` exists.
*   **Steps:**
    1.  Navigate to **Systém -> Správa uživatelů**.
    2.  Select the test user row.
    3.  Click **Organizace** button in the toolbar.
    4.  In the "Přidat přístup" dropdown, select `VACKR` (or another org).
    5.  Click **Přidat**.
    6.  In the list above, verify the org appears.
    7.  Click the **MANAGER** badge to toggle it ON (active color).
    8.  Click **Uložit změny**.
*   **Expected Result:** Dialog closes. Backend returns success.

### Scenario B: Context Enforcement (Login/Switch)
*   **Prerequisites:** Scenario A completed.
*   **Steps:**
    1.  Log out.
    2.  Log in as the `test@shanon.cz`.
    3.  User should be automatically redirected to `VACKR` dashboard (as it's their only/default org).
    4.  Verify in the top-right corner or sidebar that user has `Manager` access (e.g., can see Manager modules).
*   **Expected Result:** User is successfully logged into the assigned organization context.

### Scenario C: Multi-Org Switching
*   **Prerequisites:** Assign **User** role in a SECOND organization (e.g., `ZUZPA`) to same user.
*   **Steps:**
    1.  Log in as test user.
    2.  Click User Avatar/Profile -> Context Switcher (if implemented) OR try accessing URL `.../ZUZPA/dashboard`.
    3.  Verify current Org ID in session changes.
*   **Expected Result:** User can access both organizations.

---

## 2. Document Management (DMS)
*(To be defined)*
