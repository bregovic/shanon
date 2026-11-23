---
title: Shanon Pokladna pro Windows – tisková stanice a správa tisku
module: int
objects: int.device, int.devicePrinter, int.printRule, int.printJob
order: 40
summary: Zástupce s ikonou na ploše a tisk účtenek a dokladů rovnou na tiskárny počítače podle pravidel Správy tisku, bez dialogu tisku.
---
Prohlížeč sám tiskárnu vybrat nesmí — proto má Shanon malý program **Shanon Pokladna** pro Windows.
Běží na počítači u tiskárny, sám zjistí jeho tiskárny, vyzvedává tiskové úlohy ze Shanonu a tiskne je
bez dialogu na tiskárnu a papír podle nastavení.

## 1. Instalace na počítač

Na počítači u tiskárny: **Nastavení → Nastavení → Nainstalovat na tento počítač**. Stáhne se soubor
`Shanon-Pokladna-<kód>.cmd` s jednorázovým párovacím kódem (platí 3 dny). Spusťte ho dvojklikem; Windows se může
zeptat „Systém Windows ochránil váš počítač“ → **Další informace → Přesto spustit**.

Instalace spáruje počítač se Shanonem, stáhne prohlížeč PDF SumatraPDF (pro tichý tisk), na plochu a do nabídky Start
dá zástupce **Shanon Pokladna** s ikonou a stanici spouští po každém přihlášení do Windows. Zařízení se založí samo
a pojmenuje podle názvu počítače.

Jinak: [Integrace → Zařízení](/int/device) → **Nový** (kód, název) → **Stáhnout instalaci**.

## 2. Tiskárny zařízení

Po spuštění stanice se u zařízení na záložce **Tiskárny** objeví tiskárny Windows, které na počítači našla
(virtuální jako „Tisk do PDF“ se vynechají). U každé zkontrolujte:

- **Tiskárna** — název, pod kterým ji uvidíte v pravidlech (např. „KASA1 · XP-58“, lze přejmenovat),
- **Papír** — A4 (běžná tiskárna), role 80 mm, 58 mm nebo A6 (odhaduje se z názvu tiskárny),
- **Kopie**.

**Zkušební stránka** pošle na tiskárnu zkušební tisk. Tiskárna, kterou stanice už nehlásí, má zrušené **Nalezena na počítači**.

## 3. Správa tisku

[Integrace → Správa tisku](/int/printRule): co se kam tiskne. Každé pravidlo = **doklad → tiskárna**, případně jen:

- **při tisku z počítače** — tiskne-li se ze zástupce Shanon Pokladna na tomto počítači,
- **pro pokladnu** (účtenky) — a **Tisknout účtenku automaticky** hned po zaplacení,
- **pro uživatele**.

Platí nejpřesnější pravidlo: uživatel, pak počítač, ze kterého se tiskne, pak pokladna, pak pravidlo bez omezení.
Fakturu lze tak poslat i na tiskárnu jiného počítače (z notebooku na velkou tiskárnu u kasy).
Doklad bez pravidla se tiskne jako dřív z prohlížeče.

## Tisk

Tlačítko **Tisk** (v dokladu, v seznamu, v náhledu i v kase) pošle doklad na tiskárnu stanice a ukáže „Odesláno na tiskárnu …“.
Když stanice zrovna neběží, úloha počká a vytiskne se po jejím spuštění. Přehled a chyby: [Tiskové úlohy](/int/printJob).
Tiskárna na sériovém portu vybraná u pokladny tiskne účtenky dál sama.

## Zástupce Shanon Pokladna

Otevře Shanon ve vlastním okně s ikonou. Pokladník se po přihlášení dostane rovnou do kasy, ostatní na úvod.
Odpojení počítače: zařízení → **Odpojit** (pro nové spárování stáhněte instalaci znovu).
