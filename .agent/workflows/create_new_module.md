---
description: Jak založit a implementovat zcela nový hlavní Modul (Top-Level) v aplikaci Shanon
---

# Založení nového Modulu (New Top-Level Module Workflow)

Kdykoli padne rozhodnutí vytvořit nový hlavní "Aplikaci/Modul" ve struktuře Shanonu (např. vedle DMS, Požadavků či Systému), postupujte podle následujícího ověřeného postupu.

## 1. Začlenění do Navigace a Směrování (Routing)
Nový modul musí mít svůj "přístav" a být viditelný z hlavní lišty nahoře.

*   V `client/src/components/Layout.tsx`: Do pole `modules` vložte nový objekt.
    ```tsx
    { label: t('modules.my_module'), path: `${orgPrefix}/mymod`, icon: <SomeIcon24Regular />, securityId: 'mod_mymod' }
    ```
*   V `client/src/App.tsx`: Vytvořte logiku pro OrgGuard routing.
    *   Namapujte fallback (při kliku na `/mymod` se redirectuje na `/{orgId}/mymod` přes `ContextRedirect`)
    *   V sekci `children` v `OrgGuard` zadejte sub-routy (např. `{ path: "mymod", element: <MyModDashboard /> }`).

## 2. Vytvoření Modulového Dashboardu (`MyModDashboard.tsx`)
Každý top-level modul používá jako svůj "rozcestník" svůj vlastní Dashboard. Inspirujte se z `DmsDashboard.tsx`.
*   Zkopírujte layout pomocí `<ActionBar>` a `Breadcrumb` s navigací "Moduly > MůjModul".
*   Vytvořte Responzivní Scroll Kolonky (`<div className={styles.scrollColumn}>`).
*   Využívejte standartizované rozbalovací / zabalovací `<MenuSection>` komponenty s `<MenuItem>` vnořeními.
*   Zajistěte, aby Dashboard implementoval tlačítka *"Rozbalit vše"* a *"Sbalit vše"* na úrovni hlavičky (s využitím `Set<string>`).

## 3. Tvorba Standardních Seznamových Formulářů (`MyModList.tsx`)
*   Seznam musí ležet uvnitř obálky `<PageContent>`.
*   Data do tabulky vždy rendrujeme přes `<SmartDataGrid>` z `components/SmartDataGrid`. Povolte multi-select, pokud je povolená hromadná akce.
*   Logika zisku dat a backend proxy se nachází ve state proměnných `loading`, `error`, atd.
*   Nad tabulkou vždy použijte kontejner `<ActionBar>` pro akce jako "Založit Nový" nebo "Smazat vybrané".

## 4. Tvorba Editačních Formulářů (Drawer konvence `MyModDetail.tsx`)
*   Nikdy nevytvářejte stand-alone stránku na "Editaci záznamu", pokud k tomu nesměřuje ohromná vizuální komplexita.
*   Založení a Editace entit se děje vždy zprava formou `<Drawer position="end" type="overlay" size="large">`.
*   Při potřebě více kategorií (např. Obecné atributy, Kontaktní informace, Navázané soubory) implementujte uvnitř zásuvky komponentu `<TabList>`.
*   Vždy musí na konci formuláře v patičce obsahovat tlačítka `[Zrušit]` (Secondary) a `[Uložit]` (Primary, disabled=saving).

## 5. Zápis Bezpečnostní Definice (`SECURITY.md`)
Nezapomeňte celou sekci (např. `mod_mymod`) a jednotlivé View/Drawery zaznamenat do `.agent/SECURITY.md`. Při renderování ověřujte přes `const { hasPermission } = useAuth();`

## 6. Databázová Migrace a Backend API (`api-mymod.php`)
*   Všechna data modulu se ukládají v tabulkách s klíčem `tenant_id`.
*   Tvorba nové migrace s DDL skriptem probíhá stylem nového souboru `migrations/XXX_setup_mymod.sql` a modifikací pole `$migrations` v `install-db.php`.
*   Backend se tvoří minimálně se třemi vstupy: `action=list`, `action=get`, `action=save` a odpovídá striktně ve standardu JSON `{"success": true|false}`. Pokud padne databáze, PHP skript to catchne přes Exception a zabalí do `{"error": $e->getMessage()}`.
