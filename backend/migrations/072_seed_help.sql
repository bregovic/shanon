-- Seed initial help content
INSERT INTO sys_help_pages (topic_key, title, module, keywords, content) VALUES 
(
    'general_basics', 
    'Základní ovládání', 
    'general', 
    'ovládání, menu, navigace, favorites, oblíbené', 
    '# Základní ovládání systému

## Navigace
Hlavní menu se nachází vlevo. Je rozděleno do sekcí podle modulů (DMS, Systém, atd.).
Pro přepínání mezi organizacemi použijte rozbalovací menu v horní liště (vlevo od uživatelského profilu).

## Oblíbené položky (Favorites)
Kteroukoliv funkci v menu si můžete přidat do **Oblíbených** kliknutím na ikonu hvězdičky ☆ v menu.
- **Přidání:** Klikněte na prázdnou hvězdičku u položky menu.
- **Odebrání:** Klikněte na žlutou hvězdičku.
- **Rychlý přístup:** Seznam oblíbených položek naleznete pod ikonou hvězdičky v horní liště aplikace (vedle výběru modulu).

## Klávesové zkratky
Systém podporuje řadu klávesových zkratek pro zrychlení práce:
- `Shift + N`: Nový záznam
- `Shift + S`: Uložit
- `Shift + R`: Obnovit data (Refresh)
- `Esc`: Zavřít okno / Zpět'
),
(
    'general_grid',
    'Filtrování a Tabulky',
    'general',
    'grid, tabulka, řazení, filtr, excel',
    '# Práce s tabulkami

## Řazení a Filtrování
- **Řazení:** Klikněte na záhlaví sloupce pro seřazení (vzestupně/sestupně).
- **Filtrování:** Pod záhlavím tabulky jsou vyhledávací pole. Zadejte text a stiskněte Enter (nebo vyčkejte).
  - Pro číselné hodnoty lze použít `>100`, `<500`.
  - Pro datum lze zadat část data, např. `2024`.

## Export dat
Většina tabulek umožňuje export do **Excelu**. Hledejte ikonu Excelu (zelená) v nástrojové liště nad tabulkou.'
),
(
    'dms_intro',
    'Průvodce DMS',
    'dms',
    'dokumenty, upload, ocr, schválení',
    '# Document Management (DMS)

Modul DMS slouží k evidenci, vytěžování a schvalování dokumentů.

## Workflow dokumentu
1. **Nahrání:** Dokumenty nahrajete přetažením myší (Drag&Drop) nebo tlačítkem "+ Nový".
2. **OCR Vytěžení:** Systém automaticky přečte obsah faktury/účtenky. Tento proces trvá několik sekund.
3. **Revize:** Dokument se stavem `Ke kontrole` vyžaduje vaši pozornost. Zkontrolujte, zda systém správně přečetl IČO, částku a datumy.
4. **Schválení:** Po kontrole dokument schvalte. Tím se uzamkne a je připraven k zaúčtování.'
)
ON CONFLICT (topic_key) DO UPDATE SET 
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    keywords = EXCLUDED.keywords;
