# SHANON: UI & Form Standards
*Human-readable guidelines for creating consistent interfaces.*

## 1. Visual Philosophy: "Business Premium"
We follow the **Microsoft Fluent UI (Investyx/D365)** aesthetic.
- **Cleanliness:** Whitespace is your friend. Don't cram everything together.
- **Hierarchy:** Use bold headers, subtle dividers, and card containers.
- **Feedback:** Every action must have a reaction (spinner, notification badge, toast).

---

## 2. Layout Structure & Responsivity (Desktop vs Mobile)

### Desktop (Standard)
- **3-Column Layout:** Main content in center, Navigation left, Context/details right.
- **Cards:** Group related fields into `<Card>` components.
- **Filter Row:** Grids should have filters directly under headers, not separate huge forms above.

### Mobile (Priority)
- **Collapse:** 3 columns -> 1 column stack.
- **No Horizontal Scroll:** Forms MUST fit the width. Use `flex-wrap` or `flex-direction: column`.
- **Touch Targets:** Buttons must be big enough (min 44px height implication).
- **Navigation:** Use Hamburger menu or bottom bar logic for main mods.

---

## 3. Label Optimization Rules
**Goal:** Reuse existing logic, minimize translation bloat.

### DO NOT:
- Create `users.save_btn`, `dms.btn_save`, `settings.save`.
- Hardcode strings like `<Button>Uložit</Button>`.

### DO:
- Use `common.save` everywhere.
- Use `t('common.save')` context.
- If a specific meaning is needed, verify if it's truly unique (e.g., "Post & Print" -> `actions.post_and_print`).

---

## 4. Components & Behavior

### Buttons
- **Primary:** Only one per visual area (Save, Submit, Create). Blue/Brand color.
- **Secondary:** Cancel, Back. Subtle/Gray.
- **Destructive:** Delete. Red text or background (with confirmation).

### Forms
- **Validation:** Real-time (onBlur) is better than "on Submit".
- **Required Fields:** Mark with asterisk `*`.
- **IDs:** Fields should have nice IDs (`#field-email`) to help automated testing.

### Grids (SmartDataGrid)
- **Alignment:** 
    - Text: Left
    - Numbers: Right
    - Dates/Bool: Center
- **Filters:** Enabled by default.

---

## 5. Security Context
- **Multi-Org:** Every form must know which Organization it belongs to.
- **Check:** Frontend must restrict actions based on `hasPermission(...)`.
- **Visual:** Disable (gray out) buttons if user lacks permission, don't just hide them unpredictably.

---

## 6. How to Build (Workflow)
1. **Check common.json** for labels.
2. **Copy a Template** (don't start from empty file).
3. **Use <PageLayout>** wrapper.
4. **Test on Mobile** devtools before committing.
