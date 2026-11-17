---
title: Deník vývoje a Aktuality
module: qa
objects: qa.changelog
order: 30
summary: Co se kdy nasadilo na produkci — stručně, při rozkliknutí popis a použití; hledání v Aktualitách.
---
## Aktuality

[Aktuality](/qa/aktuality) ukazují nasazené novinky po dnech. Klepnutím na nadpis se rozbalí popis — o co jde a jak se to používá. Hledat jde v nadpisech, popisech, oblastech i číslech požadavků; nahoře filtr Nová funkce / Změna / Oprava.

## Deník vývoje

[Deník vývoje](/qa/changelog) je evidence za Aktualitami: datum nasazení na PROD, druh, oblast, stručný nadpis, odkaz na požadavek (CR-…), verze a popis. **Zobrazit v Aktualitách** vypnuté = jen interní záznam.

Popis: odstavce oddělte prázdným řádkem, odrážka začíná „- “, **tučně** dvěma hvězdičkami.

## Jak vzniká

Vývoj běží na TEST prostředí. Po schválení releasu se změna nasadí na PROD a do deníku přibude záznam s datem nasazení (výchozí obsah v `docs/qa/4-denik-vyvoje.csv`, jde i naimportovat tlačítkem Import).
