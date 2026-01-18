# SHANON: Prompt pro Nový Formulář
> Použij tento prompt jako prefix při zadávání nových formulářů/stránek.

---

## 🔧 SYSTÉMOVÉ POŽADAVKY (Checklist)

### 1. Layout & UX (Desktop + Mobile)
- [ ] **Mobile First:** Formulář se musí vejít na šířku mobilu (žádný horiz. scrollbar). Grid sloupce se musí skrývat nebo zalamovat.
- [ ] **Struktura:** `PageLayout`, `PageHeader` (s Title/Breadcrumbs), `PageFilterBar` (skrývatelný), `PageContent`.
- [ ] **Navigace (Breadcrumbs):**
  - Klik na sekci "Modul" (např. DMS) → Jde na root modulu (reset filtrů).
  - Klik na Logo → Jde na Dashboard nebo root aktuálního modulu.
- [ ] **Nápověda:** Stránka musí mít odkaz na nápovědu (ikona `?` nebo klávesa `F1` bindovaná na kontext).

### 2. Data Grid (SmartDataGrid)
- [ ] **Personalizace:** `preferenceId="[UNIQUE_ID]"` (umožní ukládání sloupců).
- [ ] **Interakce:**
  - **Single Click:** Označí řádek (změna selection).
  - **Double Click:** Otevře detail/editaci záznamu.
- [ ] **Funkce:** Multiselect, Řazení, Filtrování (inline v hlavičce).

### 3. Action Bar & Funkce
- [ ] **ActionBar Standard:** `[Breadcrumbs] ... [Akce ▼] | [Divider] | [↻] [📎] [↗] | [Divider] | [Funkce]`
- [ ] **Standardní tlačítka:**
  - `↻` (Refresh): Icon-only, `title="Obnovit"`.
  - `📎` (DocuRef): Přílohy (pokud relevantní).
  - `↗` (Export): Export do Excelu/CSV.
- [ ] **Funkce Bar:** Tlačítko "Funkce" (Toogle) zobrazuje/skrývá `PageFilterBar` s pokročilými filtry.

### 4. Security & Data Integrity
- [ ] **Oprávnění (RBAC):** Tlačítka šedivá/skrytá přes `hasPermission('action')`.
- [ ] **Multi-Tenant:** Backend query VŽDY obsahuje `WHERE tenant_id = ?`.
- [ ] **RLS (Record Level Security):** Uživatel vidí jen svá data (pokud není admin/manager).
- [ ] **Virtuální Společnosti (Virtual Groups):**
  - **Čtení:** Query musí zohlednit `OR org_id IN (moje_skupiny)`.
  - **Zápis:** Použít `DB::resolveWriteOrgId` pro správné přiřazení sdílené skupině.

### 5. Klávesové Zkratky (Standard)
- [ ] **Esc:** Zavřít dialog / Zrušit výběr / Zpět.
- [ ] **Tab:** Nativní navigace po polích (nesmí být blokována).
- [ ] **Alt+N:** Nový záznam.
- [ ] **Alt+R:** Refresh.
- [ ] **Ctrl+S:** Uložit formulář.

---

## 📝 VZOROVÝ PROMPT (Copy & Paste)

```text
Potřebuji vytvořit nový formulář "[NÁZEV]".

Funkční požadavky:
- Grid: Multiselect, PreferenceId="[ID]", Double-click editace.
- Pole: [SEZNAM POLÍ].
- Akce: Nový, Smazat, [DALŠÍ].
- Security: Support pro sdílené organizace (Virtual Groups).

Technické požadavky:
- Dodržuj .agent/NEW_FORM_PROMPT.md a FORM_STANDARD.md.
- Optimalizace pro mobil (skrývání sloupců).
- Klávesové zkratky dle standardu.
```
