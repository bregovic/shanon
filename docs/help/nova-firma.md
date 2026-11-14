---
title: Nová firma a virtuální společnosti
module: general
objects: sys.company, sys.virtualCompany, org.entity
order: 10
summary: Založení účtované firmy z IČO, výchozí nastavení, uživatelé a sdílení číselníků mezi firmami.
---
## Založení firmy

1. Správa systému → [Založit firmu podle IČO / DIČ](/system/company-lookup). Zadejte IČO (české) nebo DIČ (zahraniční) a **Najít**.
2. **Založit** – vznikne firma s údaji organizace a sídlem a spustí se výchozí nastavení zapnutých modulů: účtový rozvrh, číselné řady, deníky, daňové kódy, sklad, platební metody…
3. Když firma už existuje, nabídne se **Aktualizovat z registru** (obnoví údaje a doplní bankovní účet z registru DPH).
4. V [Organizaci](/org/entity) doplňte bankovní účet, kontakty a **logo** (tiskne se na fakturách a účtenkách).
5. V [Uživatelé](/system/users) přidělte firmu uživatelům (role, správce firmy).

## Virtuální společnost

Když jeden provozovatel vede víc firem a chce sdílet číselníky (adresář, dodavatele, účtový rozvrh, položky…):

1. [Virtuální společnosti](/sys/virtualCompany) → **Nový**.
2. Přidejte **firmy** a **sdílené číselníky**. Sdílet lze jen číselník, který je ve firmě zatím prázdný.
3. Doklady a transakce se nesdílí nikdy – každá firma účtuje zvlášť.
4. **Osamostatnit firmu** (na firmě ve virtuální společnosti) zkopíruje sdílená data do firmy a přepojí na ně její doklady.

## Na co si dát pozor

- Nezávislé firmy (různí majitelé) do jedné virtuální společnosti nedávejte – viděly by si navzájem adresář.
- Virtuální společnost se uživatelům nepřiděluje; přidělují se skutečné firmy.
