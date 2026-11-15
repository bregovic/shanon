---
title: Vydaná faktura s QR platbou
module: ar
objects: ar.invoice, ar.invoiceLine, ar.customer
order: 10
video: 01-vydana-faktura
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

## Datum vystavení, DUZP a splatnost

Po změně data vystavení se posune i DUZP a splatnost. Splatnost se počítá podle dnů splatnosti odběratele, jinak jeho skupiny, jinak 14 dní. Ručně změněné DUZP nebo splatnost zůstanou.

## Skupina DPH

Skupina DPH se doplní z odběratele (jinak ze skupiny odběratelů) a je v hlavičce faktury. Kód DPH řádku vznikne z kombinace skupiny DPH a položky DPH (z položky, skupiny položek nebo účtu). Po změně skupiny na hlavičce se řádky přepočítají, ručně zadaný kód zůstane.

## Měna

Faktura je v měně odběratele, jinak v účetní měně. Cena položky v jiné měně se přepočte kurzem ČNB k datu faktury. Po změně měny na hlavičce se přepočtou ceny řádků, které přišly z položky.

## Import faktur z ISDOC

V seznamu vydaných faktur **Import** → soubor `.isdoc`, `.isdocx` nebo PDF s vloženým ISDOC. Založí se koncept faktury s číslem z ISDOC, odběratel se najde podle IČO / DIČ (jinak se založí z registru), řádky dostanou kód DPH podle sazby a soubor se přiloží. **Zkontrolovat** jen ověří, nic nezaloží. Fakturu se stejným číslem import odmítne.

## Zrušit zaúčtování (oprava)

Superuživatel může zaúčtovanou fakturu vrátit do konceptu: **Další ▾ → Zrušit zaúčtování**, potvrzení opsáním čísla faktury. Smažou se její zápisy v hlavní knize, DPH i položka salda a odečtená záloha se uvolní. Po opravě fakturu znovu zaúčtujte.

Nejde to, když:
- je faktura uhrazená (nejdřív zrušte párování úhrady),
- je DPH faktury v podaném přiznání nebo kontrolním hlášení,
- je účetní období uzavřené,
- faktura pohnula skladem.

Pak opravte fakturu dobropisem.
