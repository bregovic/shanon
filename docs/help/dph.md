---
title: Přiznání k DPH a kontrolní hlášení
module: tax
objects: tax.return, tax.trans, tax.taxCode, tax.parameters, tax.taxGroup, tax.itemTaxGroup
order: 10
video: 05-dph-priznani
summary: Výpočet z daňových transakcí, kontrola, XML pro EPO a podání.
---
## Odkud se berou údaje

Každé zaúčtování dokladu s DPH (faktury, zálohy, pokladní doklady, směny pokladny) zapíše **daňové transakce**. Kam patří (řádek přiznání, oddíl KH), určuje daňový kód. Přehled je v [Daňových transakcích](/tax/trans) – podle DUZP.

## Skupina DPH × položka DPH → daňový kód

Daňový kód se na dokladech určuje jako v AX: ze dvou údajů.

- **Skupina DPH** ([Skupiny DPH](/tax/taxGroup)) říká *kde a komu*: Tuzemsko, Přenesená daňová povinnost, EU, EU bez DIČ, Třetí země, Dodavatel neplátce. Nastavuje se u skupiny odběratelů / dodavatelů nebo přímo u partnera a faktura ji převezme.
- **Položka DPH** ([Položky DPH](/tax/itemTaxGroup)) říká *co*: Zboží 21 %, Zboží 12 %, Služby 21 %, Služby 12 %, Osvobozeno, Mimo předmět. Nastavuje se u položky nebo skupiny položek, pro řádky bez položky u účtu hlavní knihy.
- V detailu skupiny DPH je tabulka **položka → kód při prodeji / kód při nákupu**.

Kód jde vždy zadat i ručně – ručně zadaný kód se při změně skupin nepřepíše. V účetním deníku stačí zadat rovnou **Daňový kód** (sloupec v mřížce), skupina a položka DPH jsou v záložce **DPH**.

### Výchozí kódy pro české firmy

| Kód | Plnění | Řádek přiznání | KH |
|---|---|---|---|
| V21 / V12 | tuzemsko na výstupu | 1 / 2 | A.4, A.5 |
| P21 / P12 | tuzemsko na vstupu | 40 / 41 | B.2, B.3 |
| VPDP | přenesená povinnost – dodavatel | 25 | A.1 |
| PPDP21 / PPDP12 | přenesená povinnost – odběratel | 10 / 11 + nárok 43 / 44 | B.1 |
| PEUZ21 / PEUZ12 | pořízení zboží z EU | 3 / 4 + nárok 43 / 44 | A.2 |
| PEUS21 / PEUS12 | přijetí služby z EU | 5 / 6 + nárok 43 / 44 | A.2 |
| PZAH21 / PZAH12 | služba ze třetí země | 12 / 13 + nárok 43 / 44 | A.2 |
| PDOV21 / PDOV12 | dovoz (daň vyměřil celní úřad) | 42 | – |
| V0EU / V0SEU / V0EX | dodání zboží do EU / služba do EU / vývoz | 20 / 21 / 22 | – |
| V0OST | ostatní plnění s nárokem mimo tuzemsko | 26 | – |
| VOSV | osvobozeno bez nároku | 50 | – |
| VMIMO / P0 | mimo předmět, nákup od neplátce | – | – |

**Samovyměření** (přenesená povinnost, EU, služby ze zahraničí): faktura je bez daně, daň se při zaúčtování přizná na výstupu (MD i D 343) a zároveň uplatní nárok – vzniknou dvě daňové transakce. Kód předmětu plnění pro A.1 / B.1 je u daňového kódu (výchozí 4 = stavební a montážní práce).

### Deník a DPH

- **Částky včetně DPH** (na názvu deníku): z částky řádku se daň vypočte (1 210 → základ 1 000 + DPH 210).
- Bez té volby se DPH přičte: řádek s protiúčtem ho zahrne do protiúčtu, řádek bez protiúčtu zvýší částku dokladu (dorovnávací řádek s ní počítá).
- **Číslo daňového dokladu** v záložce DPH jde do kontrolního hlášení; prázdné = číslo dokladu.
- Před zaúčtováním ukáže **Zobrazit ▾ → Náhled dokladu** i řádek daně a oddíl DPH.

## Postup

1. V [Přiznání k DPH](/tax/return) → **Nový**: druh *Přiznání* (DP3) nebo *Kontrolní hlášení*, rok a měsíc (čtvrtletí).
2. **Vypočítat** – sečte transakce období. Zkontrolujte řádky a **upozornění** (např. doklady bez DIČ odběratele nad limit).
3. **Stáhnout XML** – soubor pro EPO Finanční správy. Ověřte ho na portálu (kontrola formuláře) a podejte.

> Systém nic nepodává sám – XML vždy nahráváte a podáváte vy.

## Na co si dát pozor

- Po výpočtu ještě můžete opravit doklady a **Vypočítat** znovu.
- Zálohy: daň z přijaté platby se přizná v období platby, na konečné faktuře se odečte (záporné transakce).
- Údaje o plátci (FÚ, kontakt) jsou v [Parametrech DPH](/tax/parameters).

## Platba DPH

1. Finanční úřad založte jako **dodavatele** s bankovním účtem pro DPH (předčíslí 705, kód banky 0710) a vyplňte ho v **Daňových parametrech** (pole Finanční úřad (dodavatel)).
2. V **Přiznání a podání** založte záznam druhu **Platba DPH** za období a dejte **Spočítat**.
3. **Zaúčtovat závazek** zúčtuje účty DPH proti dodavateli Finanční úřad a založí otevřenou položku jeho salda: částka v celých Kč jako v přiznání, VS = DIČ (číslice), splatnost 25. den po skončení období. Nadměrný odpočet vznikne jako pohledávka.
4. **Tisk ▾** ukáže částku, účet finančního úřadu, VS, splatnost a **QR platbu**.

Závazek je uhrazený, jakmile platbu z bankovního výpisu spáruje banka (VS = DIČ) na tuto položku salda — stejně jako úhradu faktury.

## Daň z příjmů

Druh **Daň z příjmů** je připravený; výpočet a podání doplníme.
