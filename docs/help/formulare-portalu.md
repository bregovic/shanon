---
title: Formulář smlouvy na portálu
module: int
objects: int.form, int.formField, int.portal
order: 36
summary: Co zájemce na portálu vyplní – pole, typy, kam se údaje uloží (adresář, adresy, smlouva), podmíněná pole, ARES, znění smlouvy, PDF a e-mail. Se šablonami k importu.
---
## K čemu to je

Portál smluv (členství, předplatné, kurzy) sbírá údaje zájemce. Které to jsou a kam se uloží, si nastavíte sami – bez programování.
Po odeslání vznikne v [Adresáři](/gab/subject) člen s adresou, [odběratel](/ar/customer) a [smlouva](/ar/agreement); všechny odpovědi zůstanou u smlouvy.

## Rychlý start se šablonou

1. Stáhněte šablonu polí:
   [Členství – osoba](/sablony/formular-clenstvi-osoba.csv) ·
   [Členství – platí osoba nebo firma (ARES)](/sablony/formular-clenstvi-firma.csv) ·
   [Přihláška na kurz](/sablony/formular-prihlaska-kurz.csv).
2. [Integrace → Formuláře](/int/form) → **Nový**: kód (např. CLENSTVI), název, nadpis a úvodní text → Uložit.
3. Ve formuláři u **Pole formuláře** dejte **Import** a vyberte staženou šablonu.
4. Pole upravte podle sebe (popisky, povinnost, možnosti výběru, pořadí) – v šabloně jsou jen příklady.
5. [Integrace → Portály](/int/portal) → portál s účelem **Smlouva**: vyberte **Formulář** a do **Znění smlouvy** vložte svoje podmínky
   (můžete vyjít ze [vzoru znění smlouvy](/sablony/zneni-smlouvy-vzor.txt) – části v [hranatých závorkách] doplňte).
6. Otevřete adresu portálu a vyzkoušejte vyplnění.

## Pole formuláře

| Údaj | Význam |
|---|---|
| **Pořadí** | v jakém pořadí se pole zobrazí |
| **Klíč** | technický název bez mezer a diakritiky (`datumNarozeni`) – v tiskové sestavě `{form.datumNarozeni}` |
| **Popisek** | co zájemce uvidí |
| **Typ** | text, delší text, e-mail, telefon, datum, číslo, výběr z možností, zaškrtávátko, **souhlas** (musí zaškrtnout), nadpis oddílu, informační text |
| **Povinné** | bez vyplnění nejde odeslat |
| **Kam uložit** | viz níže |
| **Možnosti** | u výběru z možností – jedna na řádek, nebo na jednom řádku oddělené svislou čarou (viz pod tabulkou) |
| **Nápověda** | drobný text pod polem |
| **Šířka** | polovina nebo celý řádek |
| **Zobrazit, když** | podmíněné pole – viz níže |
| **Výchozí hodnota** | předvyplněná hodnota: u výběru jedna z možností (`individuální`), u zaškrtávátka `ano`, u data `dnes` |

Možnosti na jednom řádku: `individuální|firemní`.

Kontroly na portálu: povinná pole, platný e-mail, telefon aspoň 9 číslic, datum, číslo, hodnota z možností, zaškrtnutý souhlas. Chyba se ukáže hned u pole.

## Kam uložit

- **Člen** (záznam v Adresáři): jméno, příjmení nebo celé jméno, e-mail, telefon, IČO, DIČ, poznámka. Formulář musí mít jméno a e-mail člena.
- **Trvalá adresa** a **Kontaktní adresa**: ulice, obec, PSČ (trvalá i stát – výběr s názvy států, uloží se kód CZ, SK…; bez pole Stát = CZ).
- **Firma (plátce)**: IČO s načtením z ARES, název, DIČ – ukládá se jen ke smlouvě (člen zůstane osobou).
- **Smlouva**: začátek (nevyplněný = členství od první platby, začátek i kalendář splátek se posunou na den platby), konec, číslo členské karty, **počet karet**, popis, poznámka. Počet karet u tarifu s **Cena za kartu** (položka tarifu) násobí cenu smlouvy – firemní členství.
- **Jen do smlouvy**: cokoli dalšího (datum narození, číslo dokladu, forma platby, souhlasy).

Podle Kam uložit prohlížeč zájemci sám nabídne uložené jméno, e-mail, telefon a adresu.

## Podmíněná pole (Zobrazit, když)

- `druh=firemní` – pole se ukáže jen, když má pole s klíčem `druh` hodnotu „firemní“,
- `jinaAdresa` – jen když je zaškrtnuté pole `jinaAdresa`,
- prázdné = vždy. Skryté pole se nekontroluje ani neukládá.

Příklad: zaškrtávátko „Kontaktní adresa je jiná“ (`jinaAdresa`) a pod ním kontaktní adresa se Zobrazit, když `jinaAdresa`.

## ARES

Pole s Kam uložit **Člen – IČO** nebo **Firma (plátce) – IČO** má na portálu tlačítko **Načíst z ARES**. Doplní pole stejné skupiny:
název, DIČ a u Člena i trvalou adresu. Z jedné adresy jde nejvýš 20 dotazů za hodinu.

## Znění smlouvy, PDF a e-mail

- **Znění smlouvy** (u portálu) zájemce čte a potvrzuje. Řádky jako `1. ÚVODNÍ USTANOVENÍ` nebo psané velkými písmeny se zobrazí jako nadpisy.
  Na portálu je posuvné okno (Zobrazit celé) a **Stáhnout PDF**.
- **Poslat smlouvu e-mailem** (u portálu): po uzavření dostane člen vyplněnou smlouvu a podmínky v PDF a v textu platební údaje.
- Vzhled vyplněné smlouvy upravíte v **Tiskové sestavy → Smlouva**: jednotlivé odpovědi `{form.<klíč>}` (zaškrtnutí = ano / ne),
  všechny najednou `{doc.formText}`, dále `{doc.vs}`, `{doc.cardNumber}`, `{doc.tariff}`, `{partner.name}`, `{partner.address}`…

## Platba

Po uzavření smlouvy portál ukáže částku, účet, VS a QR kód (tlačítko **Stáhnout QR kód**); stejné údaje přijdou e-mailem. QR a účet se zobrazí jen, když má firma bankovní účet (Banka → Účty).
S napojenou platební bránou (Integrace → Napojení, Comgate; na testu simulátor TEST-GATEWAY) a režimem smluv Kalendář je navíc tlačítko **Zaplatit kartou / Apple Pay / Google Pay** – po zaplacení se smlouva sama aktivuje a vystaví se faktura první splátky (úhrada brány se pak spáruje s výpisem).

## Tipy

- Rozepsaný formulář zůstane zájemci v prohlížeči, i když stránku zavře; po odeslání se smaže.
- Tarify (co se nabízí) jsou položky s vyplněnou délkou období – viz [Smlouvy](/help/smlouvy).
- Číslo členské karty, které vydáváte až po zaplacení, do formuláře nedávejte – doplníte ho u smlouvy.
