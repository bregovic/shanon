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

### Action Bar Standard (CRITICAL)
**Every page MUST have an ActionBar.** The components differ based on view type:

#### Grid/List View (přehled záznamů)
```
[Breadcrumbs] ─── [flex spacer] ─── [Akce ▼] | [↻] [📎] [↗] | [≡ Funkce]
```
| Component | Description | Implementation |
|-----------|-------------|----------------|
| **Akce** (Menu) | Primary actions: Nový, Upravit, Smazat | `<Menu><MenuTrigger><Button appearance="primary">Akce</Button></MenuTrigger>...` |
| **Divider** | Visual separator | `<div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />` |
| **Refresh** | Icon-only, soft refresh | `<Button icon={<ArrowClockwise24Regular />} appearance="subtle" onClick={fetchData} title={t('common.refresh')} />` |
| **DocuRef** | Attachments drawer | `<DocuRefButton refTable="..." refId={selectedItem?.id} disabled={!selectedItem} />` |
| **Export** | Future: Import/Export | `<Button icon={<Share24Regular />} appearance="subtle" title="Export/Import" />` |
| **Divider** | Visual separator | (same as above) |
| **Funkce** | Toggle Filter Bar | `<Button appearance={isOpen ? "primary" : "subtle"} icon={<Filter24Regular />}>Funkce</Button>` |

#### Detail/Form View (jeden záznam)
```
[Breadcrumbs] ─── [flex spacer] ─── [Akce ▼] | [↻] [📎]
```
| Component | Description | Notes |
|-----------|-------------|-------|
| **Akce** (Menu) | Context actions: Upravit, Smazat | Same pattern, fewer items |
| **Divider** | Visual separator | |
| **Refresh** | Icon-only, reload detail | Refreshes comments, history, etc. |
| **DocuRef** | Attachments drawer | `refId={viewItem.id}` (always enabled) |

#### Key Rules:
1. **Icon-only buttons** use `title` attribute for tooltip (NOT `<Tooltip>` wrapper for consistency).
2. **Refresh** NEVER has text label, only icon + title.
3. **Akce menu** is always PRIMARY appearance (blue).
4. **Order is fixed:** Akce → Divider → Refresh → DocuRef → [Export] → Divider → Funkce

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

---

## 7. Keyboard Shortcuts Standard (CRITICAL)
**Every page MUST implement standard keyboard shortcuts for accessibility and power users.**

### Global Shortcuts
| Shortcut | Action | Notes |
|----------|--------|-------|
| `Esc` | Go back / Close modal | Always works, even in inputs |
| `Shift+R` | Refresh data | Calls current page's refresh function |

### Grid/List View Shortcuts
| Shortcut | Action | Hook Usage |
|----------|--------|------------|
| `Shift+N` | New record | `useKeyboardShortcut('new', () => setAddOpen(true))` |
| `Shift+D` | Delete selected | `useKeyboardShortcut('delete', handleDelete)` |
| `Shift+F` | Toggle filters (Funkce) | `useKeyboardShortcut('toggleFilters', () => setFiltersOpen(!open))` |

### Form/Detail View Shortcuts
| Shortcut | Action | Hook Usage |
|----------|--------|------------|
| `Enter` | Confirm / Submit | `useKeyboardShortcut('enter', handleSubmit)` |
| `Shift+S` | Save | `useKeyboardShortcut('save', handleSave)` |
| `Esc` | Cancel / Go back | `useKeyboardShortcut('escape', () => navigate(-1))` |

### Implementation Example
```tsx
import { useKeyboardShortcut } from '../context/KeyboardShortcutsContext';

const MyGridPage = () => {
    useKeyboardShortcut('new', () => setIsAddDialogOpen(true));
    useKeyboardShortcut('refresh', () => loadData());
    useKeyboardShortcut('delete', () => selectedItem && handleDelete(selectedItem.id));
    useKeyboardShortcut('escape', () => navigate(-1));
    // ...
};
```

### Key Rules:
1. **Shortcuts** are blocked when typing in `<input>` or `<textarea>` (except Esc).
2. **Enter** is blocked in `<textarea>` to allow multiline.
3. **Unregistration** is automatic via hook cleanup.
4. **Handlers** MUST be stable (use useCallback or inline with correct deps).
