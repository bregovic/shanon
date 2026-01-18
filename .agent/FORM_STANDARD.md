---
description: Standard for Forms and UI interaction patterns in Shanon
---

# Form & UI Standard

To ensure consistency across the Shanon application, all modules must adhere to the following UI patterns.

## 1. Data Lists & Grids
*   **Component:** Always use `<SmartDataGrid />`.
*   **Placement:** Inside `<PageContent>`.
*   **Selection:**
    *   Use `selectionMode="multiselect"` by default for bulk actions.
    *   Use `selectionMode="single"` only if bulk actions are impossible.
*   **Interaction:**
    *   **Single Click:** Selects the row.
    *   **Double Click:** Opens the **Default Action** (usually Edit in Drawer).
*   **Action Bar:** Must use `<ActionBar>` component above the grid.

## 2. Create & Edit Flows (The "Drawer" Pattern)
*   **Standard:** All Create/Edit forms for entities (Users, Orgs, Docs) must open in a **Right-Side Drawer** (`<Drawer position="end" type="overlay" />`).
    *   *Exception:* Extremely complex entities (e.g., Document Visual Editor) may use a full-page view or specialized layout.
*   **Sizing:**
    *   `size="medium"` (default) for standard forms.
    *   `size="large"` for complex forms with tabs.
*   **Header:**
    *   Must contain a clear Title (e.g., "Nový uživatel").
    *   Must contain a Close (X) button.
*   **Footer / Actions:**
    *   Place actions at the bottom of the Drawer body (or sticky footer).
    *   **Order:** [Cancel (Secondary)] ... [Save (Primary)]
*   **Structure:**
    *   Use `<DrawerBody>` for content.
    *   Use vertical layout with `gap={16}`.
    *   For long forms, use `Tabs` inside the Drawer.

## 3. Form Inputs
*   **Labels:** Always use `<Label>` component. Use `required` prop for mandatory fields.
*   **Layout:** Stack inputs vertically on mobile, use CSS Grid/Flex for 2-column layout on desktop.
*   **Validation:**
    *   Show errors using `<MessageBar intent="error">` at the top of the form or inline below inputs.
    *   Disable "Save" button during submission (`saving` state).

## 4. Deletion
*   **Pattern:** Always require confirmation (`confirm()`, `Dialog`, or `Toast` with undo).
*   **API:** Use bulk delete endpoints (`ids: []`) where possible.

## 5. Consistency Checklist
Before merging a new form:
- [ ] Does it use SmartDataGrid?
- [ ] Does clicking "New" open a Drawer?
- [ ] Does double-click on row open Detail/Edit?
- [ ] Are buttons consistent (Primary = Blue/Filled)?
