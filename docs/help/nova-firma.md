---
title: Nová firma a virtuální společnosti
module: general
objects: sys.company, sys.virtualCompany, org.entity
order: 10
summary: Založení účtované firmy z IČO, výchozí nastavení, uživatelé a sdílení číselníků mezi firmami.
---
## Založení firmy

1. Správa systému → [Založit firmu podle IČO / DIČ](/system/company-lookup). Zadejte IČO (české) nebo DIČ (zahraniční) a **Najít**.
2. **Založit** – vznikne firma s údaji organizace a sídlem. Nová firma má zapnuté jen **minimum modulů** (Systém,
   Organizace, Adresář).
3. Přepněte se na ni (výběr firmy v hlavičce) a ve **Správě systému → [Moduly](/system/modules)** zapněte agendy, které
   firma potřebuje (Hlavní kniha, Odběratelé, Pokladna…). Zapnutí spustí jejich výchozí nastavení: účtový rozvrh, číselné
   řady, deníky, daňové kódy, sklad, platební metody, workflow…
4. Když firma už existuje, nabídne se **Aktualizovat z registru** (obnoví údaje a doplní bankovní účet z registru DPH).
5. V [Organizaci](/org/entity) doplňte kontakty a **logo** (tiskne se na fakturách a účtenkách). Po zapnutí modulů
   spusťte na organizaci **Doplnit z ARES**: obnoví jméno, sídlo, zápis v rejstříku a **činnost podle CZ-NACE**
   (převažující i další), **plátce DPH** podle registru plátců (samotné DIČ nestačí — má ho i identifikovaná osoba),
   finanční úřad do parametrů DPH a **zveřejněné bankovní účty** do modulu Banka (chybějící, opakování nic nezdvojí).
6. V [Uživatelé](/system/users) přidělte firmu uživatelům (role, správce firmy).

## Dodavatelé a položky importem

Pořadí, které funguje (každý soubor nejdřív **Zkontrolovat**, pak **Importovat**):

1. **[Adresář](/gab/subject)** – zahraniční subjekty bez IČO: sloupce *Název*, *Typ* (organization), *Země* (DE, JP…), *Poznámka* (zahraniční identifikátor).
2. **[Dodavatelé](/ap/vendor)** – stačí sloupec **IČO**: subjekt i sídlo se doplní z ARES (plátce DPH i se spolehlivostí a účty z registru DPH); zahraniční dodavatel sloupcem *Subjekt* (název z adresáře). Prázdná skupina = první skupina dodavatelů. Opakovaný import podle IČO dodavatele upraví, nezaloží znovu.
3. **Skupiny položek**, **kategorie**, nakonec **položky** se sloupcem *Obrázek* – při importu vyberte i složku s obrázky (páruje se podle názvu souboru). Značka výrobce patří do sloupce **Značka**, sloupec *Dodavatel* je skutečný dodavatel.

Velký soubor (stovky položek s obrázky) se po kontrole uloží po dávkách; kdyby se zápis přerušil, stačí import spustit znovu – položky se aktualizují podle čísla.

## Smazání zkušební firmy

Po zkoušce nebo předvedení jde firmu smazat i se všemi daty: **Správa systému → Firmy** → firma → **Další ▾ → Smazat firmu s daty**. Smaže se vše, co firmě patří – i zaúčtované doklady, zápisy hlavní knihy, DPH, saldo, číselníky, přílohy a soubory, číselné řady a přiřazení uživatelů. **Nejde to vrátit.**

- Smí jen superuživatel a musí opsat **kód firmy**.
- Firmu, ve které je právě přihlášený, smazat nejde – nejdřív se přepněte do jiné.
- Záznam o smazání (kdo, kdy, kolik záznamů) zůstane v historii.

## Virtuální společnost

Když jeden provozovatel vede víc firem a chce sdílet číselníky (adresář, dodavatele, účtový rozvrh, položky…):

1. [Virtuální společnosti](/sys/virtualCompany) → **Nový**.
2. Přidejte **firmy** a **sdílené číselníky**. Sdílet lze jen číselník, který je ve firmě zatím prázdný.
3. Doklady a transakce se nesdílí nikdy – každá firma účtuje zvlášť.
4. **Osamostatnit firmu** (na firmě ve virtuální společnosti) zkopíruje sdílená data do firmy a přepojí na ně její doklady.

## Společná data (DAT)

Skrytá firma organizace s výchozí konfigurací pro firmy. Superuživatel se do ní přepne přes **Správa systému → Společná data (DAT)**
(nebo v přepínači firem) a nastaví v ní parametry modulů (účetnictví, DPH, sklad, odběratelé, dodavatelé).
Rychlejší start: na firmě v [Organizacích](/sys/company) **Další → Naplnit Společná data z této firmy** — zkopíruje do DAT
parametry a běžné číselníky, které DAT ještě nemá, a záznamy firmy na ně napojí (ostatní firmy se nemění).

- firma, která modul zapíná a jeho parametry ještě nemá, je převezme z DAT (kopie — další úpravy jen ve firmě);
- odkazy na data jednotlivých firem (např. dodavatel Finanční úřad) se nepřebírají;
- **běžné číselníky** (měrné jednotky, platební podmínky, platební metody, formáty bankovních výpisů, tiskové sestavy):
  firmy mají kopie. Nový záznam v DAT se doplní všem firmám s modulem, které ten kód ještě nemají; změna v DAT se
  propíše do kopií, které firma neupravila. Upravená kopie (příznak *Upraveno ve firmě*) a vlastní záznam firmy se
  stejným kódem mají přednost — DAT je nepřepíše. Smazání v DAT kopie ve firmách nemaže;
- účty hlavní knihy, DPH a dimenze se přes DAT nesdílí (jen celou sadou přes virtuální společnost);
- DAT nedostává výchozí nastavení (účty, řady) a nevystavují se v ní doklady.

**Kurzy** jsou společné pro celou organizaci (stahují se jednou). Vlastní kurz firmy zadáte v kurzech měny s vyplněným
**Jen pro firmu** — pro tu firmu má přednost před společným kurzem, ostatní firmy ho nevidí v přepočtu.

## Na co si dát pozor

- Nezávislé firmy (různí majitelé) do jedné virtuální společnosti nedávejte – viděly by si navzájem adresář.
- Virtuální společnost se uživatelům nepřiděluje; přidělují se skutečné firmy.
