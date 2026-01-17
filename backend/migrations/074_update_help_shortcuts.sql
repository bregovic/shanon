-- Update help content with new keyboard shortcuts (Alt-based)
-- This migration updates existing content and adds a dedicated shortcuts article

-- Update the "Základní ovládání" article with correct shortcuts
UPDATE sys_help_pages 
SET content = '# Základní ovládání systému

## Navigace
Hlavní menu se nachází vlevo. Je rozděleno do sekcí podle modulů (DMS, Systém, atd.).
Pro přepínání mezi organizacemi použijte rozbalovací menu v horní liště (vlevo od uživatelského profilu).

## Oblíbené položky (Favorites)
Kteroukoliv funkci v menu si můžete přidat do **Oblíbených** kliknutím na ikonu hvězdičky ☆ v menu.
- **Přidání:** Klikněte na prázdnou hvězdičku u položky menu.
- **Odebrání:** Klikněte na žlutou hvězdičku.
- **Rychlý přístup:** Seznam oblíbených položek naleznete pod ikonou hvězdičky v horní liště aplikace (vedle výběru modulu).

## Klávesové zkratky
Pro seznam všech zkratek viz téma **Klávesové zkratky** v této nápovědě.'
WHERE topic_key = 'general_basics';

-- Insert dedicated shortcuts article
INSERT INTO sys_help_pages (topic_key, title, module, keywords, content) VALUES 
(
    'general_shortcuts', 
    'Klávesové zkratky', 
    'general', 
    'zkratky, klávesy, keyboard, shortcuts, ctrl, alt, esc', 
    '# Klávesové zkratky

Systém podporuje řadu klávesových zkratek pro zrychlení práce.

## Globální zkratky (fungují vždy)
| Zkratka | Akce |
|---------|------|
| `Esc` | Zavřít okno / Zpět |
| `Ctrl+S` | Uložit (ve formuláři) |
| `Alt+S` | Uložit (alternativa) |
| `Ctrl+Enter` | Odeslat formulář (funguje i v textových polích) |

## Zkratky v přehledových tabulkách
Tyto zkratky fungují pouze když **nepíšete do vyhledávacího pole**:

| Zkratka | Akce |
|---------|------|
| `Alt+N` | Nový záznam |
| `Alt+D` | Smazat vybrané |
| `Alt+R` | Obnovit data (Refresh) |
| `Alt+F` | Přepnout filtry (Funkce) |
| `Enter` | Otevřít vybraný záznam |

## Navigace ve formuláři
| Zkratka | Akce |
|---------|------|
| `Tab` | Přejít na další pole |
| `Shift+Tab` | Přejít na předchozí pole |

## Poznámka
Zkratky s klávesou `Alt` byly zvoleny, protože:
- `Ctrl+klávesa` koliduje s prohlížečem (Ctrl+T = nový tab, Ctrl+W = zavřít tab).
- `Shift+klávesa` znemožňovala psaní velkých písmen ve vyhledávacích polích.

Pokud používáte **českou klávesnici**, pravý Alt (AltGr) je rozpoznán a konflikty se speciálními znaky (@, € atd.) jsou ošetřeny.'
)
ON CONFLICT (topic_key) DO UPDATE SET 
    title = EXCLUDED.title,
    content = EXCLUDED.content,
    keywords = EXCLUDED.keywords;
