---
title: Pokladna – směna, prodej, zamknutí, uzávěrka
module: pos
objects: pos.register, pos.shift, pos.receipt, pos.box
order: 10
video: 06-pokladna
summary: Otevření směny, prodej na dotykové kase, odložené nákupy, PIN a uzávěrka do účetnictví.
---
## Začátek dne

1. [Pokladna](/kasa) – vyberte pokladnu. Pokladna s **PINem** chce nejdřív čtyřmístný PIN.
2. Když není otevřená směna, otevřete ji a zadejte počáteční hotovost.

## Prodej

- Klepněte na položku (vážené zboží se ptá na hmotnost), nebo ji najděte hledáním či čtečkou EAN.
- **Platba hotově** – zadejte přijatou částku, kasa spočítá vrácení (hotovost se zaokrouhluje na koruny). **Kartou** – přes platební terminál.
- Účtenka se vytiskne podle šablony; s EET dostane kód tržby.
- **Odložený nákup** (box s QR nebo jméno) – rozpracovaný nákup odložíte a dokončíte později nebo na jiné pokladně; kód boxu stačí naskenovat do hledání.

## Přestávka

- **Zamknout** (vlevo od Uzávěrky) – pokladna se zamkne, směna běží dál. Odemknete stejným PINem. PIN nastavíte v [Pokladny](/pos/register).

## Konec dne

1. **Uzávěrka** – zkontrolujte souhrn (účtenky, hotovost, karty, DPH) a spočítejte hotovost v pokladně.
2. Potvrzením se směna uzavře a do účetnictví jde **jeden doklad za směnu** (tržby, DPH, hotovost / karty).

## Na co si dát pozor

- Ceny a DPH počítá vždy server podle položek – kasa ukazuje jen orientační součet.
- Neodeslané tržby EET se dosílají samy (do 48 hodin); tlačítko v liště je odešle hned.

## Známý odběratel a prodej na fakturu

- **Odběratel** v košíku → vyberte odběratele (hledání podle názvu nebo IČO).
- Zaplaceno hned (hotově, kartou): účtenka se vytiskne jako **Faktura – daňový doklad** s údaji odběratele. Do účetnictví jde uzávěrkou směny jako ostatní účtenky; doklad od 10 000 Kč s českým DIČ odběratele jde do kontrolního hlášení jednotlivě.
- **Na fakturu** (zaplatí později): vystaví se zaúčtovaná vydaná faktura s cenami s DPH a splatností odběratele — je v saldu odběratele, zaplacení se spáruje z výpisu. **Tisk faktury** otevře PDF.
- **Odeslat e-mailem**: účtenku i fakturu jde poslat jako PDF (adresa se předvyplní z odběratele). Potřebuje napojení pošty v Integraci.

