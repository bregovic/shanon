---
title: Smlouvy (členství, předplatné)
module: ar
objects: ar.agreement, ap.agreement
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

## Uzavření smlouvy z portálu

1. [Integrace → Portály](/int/portal) → **Nový**, **Účel portálu** = *Smlouva (členství, předplatné)*.
2. Vyplňte nadpis, úvod a **Znění smlouvy** (text, který zájemce čte a potvrzuje); případně skupinu nových odběratelů.
3. Odkaz portálu (nebo jednoduchou adresu) dejte na web nebo do QR kódu na recepci.

Zájemce vybere tarif, vyplní jméno, e-mail, telefon, adresu a začátek a potvrdí souhlas se smlouvou. Vznikne subjekt
v adresáři (osoba), odběratel, prodejní smlouva s potvrzeným zněním a výzva k platbě; zájemce hned uvidí číslo účtu,
variabilní symbol, částku a QR kód k zaplacení. Stejná osoba (jméno a e-mail) se podruhé nezakládá.
O nové smlouvě přijde upozornění ve zvonečku.

## Na co si dát pozor

- Smlouva s nezaplacenou výzvou nevystaví další výzvu — nejdřív se musí zaplatit nebo ukončit.
- Výzva se páruje jen podle VS a celé částky; částečná platba smlouvu neaktivuje.
- Výnos ročního členství jde do výnosů celý při platbě (bez časového rozlišení).
