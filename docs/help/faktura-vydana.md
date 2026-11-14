---
title: Vydaná faktura s QR platbou
module: ar
objects: ar.invoice, ar.invoiceLine, ar.customer
order: 10
summary: Od založení faktury přes zaúčtování po PDF s QR kódem a ISDOC.
---
## Co budete potřebovat

- **Odběratele** – v [Odběratelé](/ar/customer). Nový odběratel nejrychleji z IČO přes [Adresář → Založit podle IČO](/gab/lookup) se zaškrtnutím „Vytvořit i odběratele“.
- **Bankovní účet firmy** – v [Organizaci](/org/entity) (pole Číslo účtu), jinak se použije první účet v [Bance](/bank/account). Bez účtu se na faktuře netiskne QR platba.

## Postup

1. Otevřete [Vydané faktury](/ar/invoice) a dejte **Nový**.
2. Vyberte **odběratele**. Faktura se tím sama uloží, dostane číslo z řady a doplní splatnost, měnu a variabilní symbol.
3. Přidejte **řádky**: vyberte položku (doplní popis, cenu, DPH a účet výnosů), nebo napište popis a cenu ručně. Částky a DPH se počítají samy.
4. Zkontrolujte součty a dejte **Zaúčtovat**. Vznikne účetní doklad (311 / 604 / 343), otevřená položka v saldu a daňová transakce pro přiznání DPH.
5. **Tisk** nebo **PDF** – faktura s QR platbou. PDF má v sobě vložený **ISDOC**, takže si ji odběratel načte do účetnictví sám. Samotný ISDOC stáhnete tlačítkem **ISDOC**.
6. **Odeslat e-mailem** – připraví e-mail odběrateli s PDF v příloze; zkontrolujete a odešlete (viz [Odesílání faktur e-mailem](/help/posta)).

> Tlačítky **Doklad HK** a **DPH** nahoře ověříte, co se zaúčtovalo.

## Na co si dát pozor

- **Plátce DPH** musí mít u každého řádku sazbu (i 0 %). Bez ní fakturu nezaúčtujete – jinak by DPH chybělo v přiznání.
- **QR platba** se netiskne, když chybí bankovní účet, faktura je už uhrazená nebo je vypnutá transformace [QR platba (SPAYD)](/sys/transformation).
- Zaúčtovanou fakturu nejde měnit. Opravu udělejte dobropisem (nová faktura se zápornými řádky).
- **Souvislá řada**: když v [číselné řadě](/sys/numberSeq) zaškrtnete Souvislá řada, číslo smazaného konceptu se použije znovu.
