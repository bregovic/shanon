# SHANON: Prompt pro Nový Formulář
> Použij tento prompt jako prefix při zadávání nových formulářů/stránek.

---

## 🔧 SYSTÉMOVÉ POŽADAVKY (Musí být splněny)

### Layout & Komponenty
- [ ] `PageLayout`, `PageHeader`, `PageContent` wrapper
- [ ] `Breadcrumb` navigace (Systém → Modul → Aktuální stránka)
- [ ] `ActionBar` s tlačítky dle standardu:
  - **Grid:** `Akce ▼` → Divider → `↻` (icon-only) → `📎 DocuRef` → Divider → `Funkce`
  - **Detail:** `Akce ▼` → Divider → `↻` → `📎`
- [ ] `SmartDataGrid` pro tabulky (NE raw DataGrid)
- [ ] `Drawer` pro editační panely, `Dialog` pouze pro potvrzení

### Labely & Překlady
- [ ] **Žádné hardcoded texty** - vždy `t('key')`
- [ ] Používej `common.*` klíče (`common.save`, `common.cancel`, `common.new`)
- [ ] Netvořit duplicitní překlady (`users.save` ❌ → `common.save` ✅)

### Keyboard Shortcuts
```tsx
useKeyboardShortcut('new', () => setAddOpen(true));
useKeyboardShortcut('refresh', handleRefresh);
useKeyboardShortcut('escape', () => navigate(-1));
useKeyboardShortcut('save', handleSave);
```
- `Alt+N` = Nový, `Alt+R` = Refresh, `Alt+D` = Smazat, `Alt+F` = Funkce
- `Ctrl+S` = Uložit, `Esc` = Zpět/Zavřít

### Security (RBAC)
- [ ] Backend: Kontrola role (`admin`, `superadmin`, `sysadmin`)
- [ ] Backend: Filtrování `WHERE tenant_id = ? AND org_id = ?`
- [ ] Frontend: `hasPermission()` pro skrytí/disable tlačítek
- [ ] Nepoužívat `alert()` - jen `Toast` nebo `MessageBar`

### Data Grid Features
- [ ] Multiselect: `selectionMode="multiselect"`
- [ ] `getRowId={(item) => item.rec_id}`
- [ ] `onSelectionChange` pro hromadné akce
- [ ] Filtrování automaticky přes SmartDataGrid
- [ ] **Row Click Behavior** (vybrat jednu možnost):
  - `onRowClick` → Otevřít Drawer pro editaci (jednodušší entity)
  - `onRowClick` → Navigovat na detail stránku (komplexní entity s podřízenými daty)
  - Žádný `onRowClick` → Pouze selection (pro hromadné operace)

### Forms
- [ ] Validace onBlur (ne jen onSubmit)
- [ ] Required pole označena `*`
- [ ] Unikátní `id` atributy pro testování
- [ ] Save/Cancel tlačítka dole vpravo

### API Pattern
```tsx
const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

// nebo použij:
const { getApiUrl } = useAuth();
fetch(getApiUrl('api-endpoint.php?action=list'))
```

### Session & Context
```tsx
const { currentOrgId } = useAuth();
const orgPrefix = `/${currentOrgId || 'VACKR'}`;
```

---

## 📋 CHECKLIST PRO NOVÝ FORMULÁŘ

1. **Vytvořit stránku** v `client/src/pages/[NazevPage].tsx`
2. **Registrovat routu** v `App.tsx`
3. **Vytvořit API** v `backend/api-[nazev].php`
4. **Přidat překlady** do `locales/cs.json` (preferuj `common.*`)
5. **Přidat do menu** v příslušném `ModuleDashboard.tsx`
6. **Přidat migraci** pokud nová tabulka (s `COMMENT ON TABLE`)

---

## 📝 VZOROVÝ PROMPT

```
Potřebuji vytvořit nový formulář pro [NÁZEV ENTITY].

Požadavky:
- Grid s multiselect, filtrování, řazení
- Drawer pro vytvoření/editaci záznamu
- Pole: [seznam polí]
- Akce: Nový, Upravit, Smazat, Export

Dodržuj standardy z .agent/FORM_STANDARD.md a .agent/CONTEXT_PROMPT.md.
```

---

## 🚀 QUICK REFERENCE

| Co | Jak |
|----|-----|
| Refresh tlačítko | `<Button icon={<ArrowClockwise24Regular />} appearance="subtle" title={t('common.refresh')} />` |
| Divider v ActionBar | `<div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />` |
| Funkce toggle | `<Button appearance={showFilters ? 'primary' : 'subtle'} icon={<Filter24Regular />}>Funkce</Button>` |
| Loading state | `<Spinner label="Načítání..." />` |
| Error feedback | `<MessageBar intent="error">{error}</MessageBar>` |
| Success toast | `dispatchToast(<Toast>Uloženo</Toast>, { intent: 'success' })` |
