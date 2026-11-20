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
5. V [Organizaci](/org/entity) doplňte bankovní účet, kontakty a **logo** (tiskne se na fakturách a účtenkách).
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

## Na co si dát pozor

- Nezávislé firmy (různí majitelé) do jedné virtuální společnosti nedávejte – viděly by si navzájem adresář.
- Virtuální společnost se uživatelům nepřiděluje; přidělují se skutečné firmy.
