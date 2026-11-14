---
title: Přiznání k DPH a kontrolní hlášení
module: tax
objects: tax.return, tax.trans, tax.taxCode, tax.parameters
order: 10
summary: Výpočet z daňových transakcí, kontrola, XML pro EPO a podání.
---
## Odkud se berou údaje

Každé zaúčtování dokladu s DPH (faktury, zálohy, pokladní doklady, směny pokladny) zapíše **daňové transakce**. Kam patří (řádek přiznání, oddíl KH), určuje daňový kód. Přehled je v [Daňových transakcích](/tax/trans) – podle DUZP.

## Postup

1. V [Přiznání k DPH](/tax/return) → **Nový**: druh *Přiznání* (DP3) nebo *Kontrolní hlášení*, rok a měsíc (čtvrtletí).
2. **Vypočítat** – sečte transakce období. Zkontrolujte řádky a **upozornění** (např. doklady bez DIČ odběratele nad limit).
3. **Stáhnout XML** – soubor pro EPO Finanční správy. Ověřte ho na portálu (kontrola formuláře) a podejte.

> Systém nic nepodává sám – XML vždy nahráváte a podáváte vy.

## Na co si dát pozor

- Po výpočtu ještě můžete opravit doklady a **Vypočítat** znovu.
- Zálohy: daň z přijaté platby se přizná v období platby, na konečné faktuře se odečte (záporné transakce).
- Údaje o plátci (FÚ, kontakt) jsou v [Parametrech DPH](/tax/parameters).
