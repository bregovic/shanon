---
title: Shanon pro Windows – tisk bez dialogu a správa tisku
module: int
objects: int.device, int.devicePrinter, int.printRule, int.printJob, int.printerModel
order: 40
summary: Zástupce Shanon s ikonou na ploše a tisk účtenek a dokladů rovnou na tiskárny počítače, bez dialogu tisku.
---
Prohlížeč sám tiskárnu vybrat nesmí — proto má Shanon pro Windows malý program, který na počítači u tiskárny
sám zjistí jeho tiskárny, vyzvedává tiskové úlohy ze Shanonu a tiskne je bez dialogu.

## 1. Instalace na počítač

Na počítači u tiskárny: **Nastavení → Aplikace → Nainstalovat** a spusťte stažený **Shanon-instalace.exe**
(odkaz platí 3 dny a jen jednou). Dokud instalátor není podepsaný, Windows se zeptá „Systém Windows ochránil váš
počítač“ → **Další informace → Přesto spustit**.

Instalace spáruje počítač se Shanonem, dá na plochu a do nabídky Start zástupce **Shanon** s ikonou a tisk spouští
po každém přihlášení do Windows. Zařízení se založí samo a pojmenuje podle názvu počítače.
(Jinak: [Integrace → Zařízení](/int/device) → **Nový** → **Stáhnout instalaci**.) Instalátor si odkaz zjistí ze záznamu
Windows o stažení; když ho nenajde (soubor zkopírovaný jinam), zeptá se na odkaz.

## 2. Tiskárny počítače

U zařízení se na záložce **Tiskárny** objeví tiskárny Windows, které program na počítači našel (bez virtuálních
jako „Tisk do PDF“). Papír se odhadne z názvu (XP-58 → 58 mm, POS / TM → 80 mm, ostatní A4) — upravte ho, případně
kopie, a pošlete **Zkušební stránku**.

Hned se založí i výchozí pravidla: **účtenky** na tiskárnu na roli (vytisknout hned po zaplacení) a **ostatní doklady**
na tiskárnu A4 — obojí při tisku z tohoto počítače. Tiskárnu účtenek lze vybrat i přímo u pokladny
(Pokladna → Zařízení → **Tiskárna počítače**).

## 3. Správa tisku

[Integrace → Správa tisku](/int/printRule): co se kam tiskne. Pravidlo = **doklad** (nebo **Ostatní doklady**) → **tiskárna**,
případně jen **při tisku z počítače**, jen pro **pokladnu** (účtenky; **Tisknout účtenku automaticky**) nebo pro **uživatele**.
Platí nejpřesnější pravidlo. Doklad bez pravidla se tiskne jako dřív z prohlížeče.

## Tisk

Tlačítko **Tisk** (v dokladu, v seznamu, v náhledu i v kase) pošle doklad na tiskárnu a ukáže „Odesláno na tiskárnu …“.
Když program na počítači zrovna neběží, úloha počká. Přehled a chyby: [Tiskové úlohy](/int/printJob).

## Tisk z běžného prohlížeče

Zástupce **Shanon** otevírá Shanon ve vlastním okně, které ví, že je na počítači se stanicí. Tisk z **běžného
prohlížeče** (Chrome, Edge) na stejném počítači jde na tiskárny stanice, když Shanon počítač pozná:

- prohlížeč, ze kterého jste stáhli instalaci (Nastavení → Nainstalovat na tento počítač), si počítač zapamatuje sám;
- v jiném prohlížeči vyberte v **Nastavení → Tento prohlížeč tiskne přes počítač**;
- bez výběru se použije počítač, jehož **Uživatelem počítače** jste (Integrace → Zařízení; doplní se při instalaci) –
  jen když je takový jeden.

## Diagnostika tohoto počítače

**Nastavení → Diagnostika tohoto počítače** ukáže, jestli Shanon tento prohlížeč pozná (a podle čeho), jestli stanice
na počítači běží (naposledy ozvaná, verze programu), jaké tiskárny Windows nahlásila – papír, výchozí, **stav**
(připravená, tiskne, offline, došel papír, zaseknutý papír, otevřený kryt, toner, chyba) a úlohy ve frontě Windows –
a kam teď půjde účtenka a ostatní doklady. **Obnovit stav tiskáren** si vyžádá stav hned, **Zkušební stránka**
vytiskne test. Tiskárna, kterou Windows nemají nainstalovanou (chybí ovladač), se v seznamu neobjeví – nainstalujte
nejdřív ovladač tiskárny ve Windows.

Program stanice se od verze 1.1 aktualizuje sám; starší verzi nainstalujte jednou znovu (Nainstalovat na tento počítač).

## Zrušení tisku

V **Integrace → Tiskové úlohy** (nebo u zařízení) jde čekající či odeslanou úlohu **Zrušit tisk** (i víc najednou).
Stanice ji pak nevytiskne. Úlohu, kterou už Windows poslala tiskárně, zastavíte ve frontě tiskárny ve Windows.

## Kasa bez připojení

Když vypadne internet, kasa prodává dál: platba **hotově** nebo **kartou na samostatném terminálu** se uloží v pokladně,
účtenka dostane číslo z offline řady kasy (`OF-…`) a vytiskne se na místě. Nahoře svítí **Neodesláno: N** — prodeje se
odešlou samy, jakmile je připojení (EET dodatečně). Uzávěrku směny jde udělat až po odeslání. Kasu otevřenou dříve
na tomto počítači jde otevřít i bez připojení. Odběratel, QR platba, prodej na fakturu a odložené nákupy potřebují připojení.

## Diagnostika, používané tiskárny a katalog

**Integrace → Diagnostika tohoto počítače** (i v detailu zařízení a v Nastavení) ukáže, zda Shanon počítač zná, zda stanice běží
a jaké tiskárny Windows hlásí. Počítač, který Shanon nezná, přidáte tlačítkem **Přidat tento počítač** (stáhne instalaci stanice).

Tiskárny jsou **používané** a **nalezené**: v pravidlech tisku a u pokladny se nabízejí jen používané. Zaškrtnutím je zapnete
nebo vypnete. Nová tiskárna se zapne sama, jen když je výchozí ve Windows, je na účtenky nebo ji zná katalog.

**Katalog tiskáren** (Integrace → Zařízení → Katalog tiskáren): u tiskárny **Uložit do katalogu** zapíše model s papírem, počtem kopií
a použitím. Stejná tiskárna na dalším počítači to převezme sama. Do katalogu jde vložit odkaz na **ovladač výrobce** — diagnostika
ho nabídne u USB tiskárny, která na počítači ovladač nemá. Ovladače se do Shanonu nenahrávají.
