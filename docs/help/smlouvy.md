---
title: Smlouvy (členství, předplatné)
module: ar
objects: ar.agreement, int.form, int.formField, ap.agreement
order: 25
summary: Prodejní a nákupní smlouva na opakované období — výzva k platbě, aktivace po platbě, faktura a výnos samy, blokace po lhůtě; uzavření z veřejného portálu.
---
## K čemu to je

Smlouva na opakované období: členství ve fitku, předplatné, nájem, servis. Smlouva sama hlídá, za co je zaplaceno,
vystavuje výzvy k platbě a po zaplacení účtuje výnos. **Prodejní smlouvy** jsou u odběratelů, **nákupní smlouvy**
u dodavatelů (fungují stejně, platby jdou opačným směrem).

## Tarify

Tarif = [položka](/inv/item) s vyplněnou **Délkou období (měsíce)** v sekci *Tarif smlouvy* a s prodejní cenou
(u prodeje s DPH). Například *Členství měsíční* 1 200 Kč / 1 měsíc a *Členství roční* 10 000 Kč / 12 měsíců.
Smlouva s tarifem si cenu, délku období a popis doplní sama.

## Průběh smlouvy

1. **Koncept** – smlouva je založená, nic se neúčtuje.
2. **Vyzvat k platbě** – vznikne prodejní objednávka na jedno období a zálohová faktura (výzva k platbě s VS a QR kódem).
   Stav **Čeká na platbu**.
3. Platbu spáruje [bankovní výpis](/help/banka-vypisy) podle variabilního symbolu. Po zaúčtování výpisu je smlouva
   **Aktivní** do konce zaplaceného období (*Zaplaceno do*) a z objednávky vznikne **zaúčtovaná faktura** — záloha se
   v ní odečte, výnos jde na účet výnosů.
4. Dávka **Smlouvy – výzvy k platbě a blokace** (každý den) vystaví výzvu na další období ve stanovený počet dní před
   koncem zaplaceného období. Smlouva mezitím zůstává aktivní.
5. Když výzva není zaplacená ani po **splatnosti + lhůtě blokace**, smlouva je **Blokovaná**. Pozdní platba ji zase aktivuje.
6. **Ukončit smlouvu** – nezaplacená výzva se zruší, další období už nevznikají.

Lhůty se nastavují v [Parametrech odběratelů](/ar/parameters) (u dodavatelů v jejich parametrech), sekce *Smlouvy*:
splatnost výzvy, blokovat po splatnosti, výzva před koncem období.

## Placení podle kalendáře (bez zálohy)

V [parametrech odběratelů](/ar/parameters) zvolte **Placení smluv → Kalendář – faktury po aktivaci první platbou** (třeba fitness, kluby).

1. Smlouva dostane **VS** = číslice čísla smlouvy (SM2600012 → 2600012) a můžete vyplnit **číslo členské karty**.
2. **Vyzvat k platbě** vytvoří **kalendář splátek** (měsíčně nebo ročně podle délky období tarifu; do konce smlouvy, bez konce na rok dopředu). Objednávka ani záloha nevzniká.
3. **První platba** s VS smlouvy a částkou první splátky (krok párování výpisu *VS smlouvy*) smlouvu **aktivuje**: vznikne objednávka a zaúčtovaná faktura první splátky a platba se na ni spáruje. Platbu kartou nebo hotově na recepci potvrďte tlačítkem **Aktivovat (zaplaceno)**.
4. Denní dávka pak podle kalendáře vystavuje další splátky (objednávka → faktura = pohledávka, VS smlouvy, splatnost z parametrů). Platby s VS smlouvy se párují na nejstarší neuhrazenou fakturu smlouvy.
5. Faktura neuhrazená po **splatnosti + lhůtě k blokaci** (parametry, např. splatnost 3 dny a lhůta 0) smlouvu **zablokuje** – další splátky se nevystavují. Úhradou se smlouva zase aktivuje.

Nezaúčtovanou smlouvu, objednávku i nezaplacenou zálohu jde smazat (smaže se i to, co k nim patří); smlouvu s fakturami nebo zaplacenou zálohou ukončete tlačítkem **Ukončit**.

## Uzavření smlouvy z portálu

1. [Integrace → Portály](/int/portal) → **Nový**, **Účel portálu** = *Smlouva (členství, předplatné)*.
2. Vyplňte nadpis, úvod a **Znění smlouvy** (text, který zájemce čte a potvrzuje); případně skupinu nových odběratelů.
3. Odkaz portálu (nebo jednoduchou adresu) dejte na web nebo do QR kódu na recepci.

Zájemce vybere tarif, vyplní jméno, e-mail, telefon, adresu a začátek a potvrdí souhlas se smlouvou. Vznikne subjekt
v adresáři (osoba), odběratel, prodejní smlouva s potvrzeným zněním a výzva k platbě; zájemce hned uvidí číslo účtu,
variabilní symbol, částku a QR kód k zaplacení. Stejná osoba (jméno a e-mail) se podruhé nezakládá.
O nové smlouvě přijde upozornění ve zvonečku.

## Formulář smlouvy na portálu

Co člen na portálu vyplní, nastavíte bez programování v [Integrace → Formuláře](/int/form) a formulář vyberete u portálu (pole **Formulář**).

- **Pole formuláře:** klíč (technický název), popisek, **typ** (text, delší text, e-mail, telefon, datum, číslo, výběr z možností – jedna na řádek, zaškrtávátko, **souhlas** – musí zaškrtnout, nadpis oddílu, informační text), povinné, šířka (půl / celý řádek), nápověda.
- **Kam uložit:** člen v Adresáři (jméno, příjmení / celé jméno, e-mail, telefon, IČO, DIČ, poznámka), trvalá a kontaktní adresa, smlouva (začátek, konec, číslo členské karty, popis, poznámka), nebo **jen do smlouvy**. Formulář musí mít jméno a e-mail člena.
- Všechny odpovědi zůstanou u smlouvy (**Údaje z formuláře**).
- **Zobrazit, když:** pole se ukáže jen podle jiné odpovědi – `druh=firemní` (výběr), `firma` (zaškrtnuté). Skryté pole se nekontroluje ani neukládá (třeba IČO jen u firemního členství).
- Člen vyplňuje pohodlně: prohlížeč nabídne uložené jméno, e-mail, telefon a adresu (podle Kam uložit), chyby se ukážou hned u pole a rozepsaný formulář zůstane v prohlížeči, i když stránku zavře.
- **Obchodní podmínky** (Znění smlouvy u portálu) se na portálu ukážou s nadpisy a odstavci v posuvném okně (Zobrazit celé) a jdou stáhnout jako PDF.
- **Poslat smlouvu e-mailem** (u portálu, výchozí zapnuto): po uzavření dostane člen vyplněnou smlouvu (sestava Smlouva) a obchodní podmínky v PDF a platební údaje v textu. Odchází napojením pošty; na testovacím serveru dostane e-mail uživatel, ne člen.
- **Tisková sestava Smlouva** (Tiskové sestavy → návrhář): logo, firma, člen, tarif, VS, číslo karty, znění smlouvy a údaje formuláře – jednotlivě `{form.<klíč>}` (např. `{form.datumNarozeni}`, zaškrtnutí = ano / ne) nebo všechny najednou `{doc.formText}`.

## Na co si dát pozor

- Smlouva s nezaplacenou výzvou nevystaví další výzvu — nejdřív se musí zaplatit nebo ukončit.
- Výzva se páruje jen podle VS a celé částky; částečná platba smlouvu neaktivuje.
- Výnos ročního členství jde do výnosů celý při platbě (bez časového rozlišení).
