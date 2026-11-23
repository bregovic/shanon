---
title: Shanon Pokladna pro Windows – tisková stanice
module: int
objects: int.device, int.printJob, int.printRoute, int.connection
order: 40
summary: Zástupce s ikonou na ploše a tisk účtenek a dokladů rovnou na tiskárny počítače, bez dialogu tisku.
---
Prohlížeč sám tiskárnu vybrat nesmí — proto má Shanon malý program **Shanon Pokladna** pro Windows.
Běží na počítači u tiskárny, vyzvedává tiskové úlohy ze Shanonu a tiskne je bez dialogu na tiskárnu
a papír podle nastavení.

## Instalace

1. [Integrace → Zařízení](/int/device) → **Nový**: kód (např. KASA1), název, případně pokladna u tohoto počítače. Uložit.
2. **Stáhnout instalaci** — stáhne se soubor `Shanon-Pokladna-<kód>.cmd`. Obsahuje jednorázový párovací kód (platí 3 dny).
3. Na počítači u tiskárny soubor spusťte dvojklikem. Windows se může zeptat „Chránil(a) jsem váš počítač“ → **Další informace → Přesto spustit**.
4. Instalace spáruje počítač se Shanonem, stáhne prohlížeč PDF SumatraPDF (pro tichý tisk), na plochu a do nabídky Start dá zástupce
   **Shanon Pokladna** s ikonou a stanici spouští po každém přihlášení do Windows.

U zařízení pak uvidíte **Naposledy online**, počítač a seznam tiskáren Windows (výchozí s hvězdičkou).

## Tiskárny

[Integrace → Napojení](/int/connection) → **Nový**: druh **Tiskárna účtenek**, ovladač **Tisková stanice**.

- **Zařízení** — počítač se Shanon Pokladna.
- **Tiskárna ve Windows** — název přesně podle seznamu u zařízení; prázdné = výchozí tiskárna počítače.
- **Papír** — 80 mm, 58 mm nebo A6 (účtenka se přeskládá); **Kopie**.
- **Doklady na tiskárnu** — které doklady se sem tisknou (faktura, objednávka…), případně jen pro jednoho uživatele.
- **Test spojení** pošle zkušební stránku.

Účtenky jdou na tiskárnu vybranou u pokladny (Pokladna → Zařízení → Tiskárna). Ostatní doklady podle **Doklady na tiskárnu**:
přednost má pravidlo pro uživatele, pak tiskárna počítače, ze kterého tisknete (zástupce Shanon Pokladna), pak podle kódu.
Doklad bez pravidla se tiskne jako dřív z prohlížeče.

## Tisk

Tlačítko **Tisk** (v dokladu, v seznamu, v náhledu i v kase) pošle doklad na tiskárnu stanice a ukáže „Odesláno na tiskárnu …“.
Když stanice zrovna neběží, úloha počká a vytiskne se po jejím spuštění. Přehled a chyby: [Tiskové úlohy](/int/printJob).

## Zástupce Shanon Pokladna

Otevře Shanon ve vlastním okně s ikonou. Pokladník se po přihlášení dostane rovnou do kasy, ostatní na úvod.
Odpojení počítače: zařízení → **Odpojit** (pro nové spárování stáhněte instalaci znovu).
