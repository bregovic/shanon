---
title: Účetní deník a hlavní kniha
module: gl
objects: gl.journal, gl.journalLine, gl.account, gl.voucher, gl.trans
order: 10
video: 04-obecny-denik
summary: Ruční zápisy, druhy účtů (odběratel, dodavatel, banka), ověření a zaúčtování; účtový rozvrh.
---
## Kde deníky najdete

Každý modul má své deníky: [Obecné deníky](/gl/journal?filter.journalType=daily) v Hlavní knize, **Bankovní deníky** v Bance, **Pokladní deníky** v Pokladně, **Deníky plateb** u odběratelů a dodavatelů. **Nový** v takovém seznamu založí deník správného druhu (název deníku se doplní sám). Všechny deníky jsou v [Všechny deníky](/gl/journal).

## Deník

1. **Nový**, doplňte popis a **Uložit** ([[Ctrl+S]]). Název deníku určuje druh, číslování dokladů a výchozí protiúčet.
2. Řádky v mřížce: **druh účtu** (hlavní kniha, odběratel, dodavatel, banka, pokladna), účet, text, **MD** nebo **D**, případně **protiúčet** na stejném řádku.
   - Odběratel / dodavatel zapíše i do salda; úhrada s **VS** spáruje fakturu.
3. **Ověřit** – kontrola vyrovnanosti, účtů, období a dimenzí bez zaúčtování. Výsledek je v poli *Ověření*.
4. **Zaúčtovat** – doklady vzniknou s čísly, která vidíte na řádcích.

## Rychlé pořizování (jako v AX)

| Klávesa | Co udělá |
|---|---|
| [[Enter]] | uloží řádek a skočí na **účet** dalšího řádku |
| [[Tab]] / [[Shift+Tab]] | další / předchozí pole (datum a číslo dokladu přeskočí – plní se samy) |
| [[↑]] / [[↓]] | řádek výš / níž ve stejném sloupci (řádek se při odchodu uloží) |
| psaní v poli účtu | nabídka podle čísla i názvu, [[↓]] a [[Enter]] vybere |

- **Datum**: nový řádek převezme datum předchozího řádku (první řádek datum deníku). Zkratky: `d` = dnes, `d+1` / `d-1`, `15` = 15. tohoto měsíce, `1511` = 15. 11., `15.11.26`.
- **Číslo dokladu** se ukáže hned po uložení řádku. Při číslování *po vyrovnání* drží řádky stejné číslo, dokud doklad není vyrovnaný; pak začne nový.
- **Dorovnání**: dokud doklad není vyrovnaný, nový řádek má předvyplněné jeho číslo a zbývající částku na opačné straně – stačí vybrat účet a [[Enter]].
- Text a druh účtu se přebírají z předchozího řádku. Záporná částka v MD se přesune do D (a naopak).
- Pod mřížkou je vidět, které doklady nejsou vyrovnané a o kolik; řádky takového dokladu mají oranžový proužek.

## Vyrovnání s otevřenými položkami

Řádek, který hradí doklady odběratele či dodavatele, vyrovnáte v menu **Funkce ▾ → Vyrovnat…** nad mřížkou (pro vybraný řádek); **Zrušit vyrovnání** výběr smaže.

V dialogu nejdřív zvolte **Co vyrovnat**:
- **Faktury a dobropisy** – i víc dokladů najednou a i částečně;
- **Zálohy** – jedna záloha na řádek a na celou částku řádku; řádek se zaúčtuje na účet záloh (324 / 314) včetně DPH ze zálohy, stejně jako úhrada z výpisu;
- **Smlouvy – první platba** – smlouva čekající na první platbu (režim Kalendář); částka = první splátka. Zaúčtování smlouvu aktivuje (faktura první splátky) a platba fakturu uhradí.


- Dialog ukáže otevřené položky **partnera řádku**; vypnutím *Jen partner řádku* hledáte u všech – podle druhu (odběratelé / dodavatelé), **VS**, **částky**, data a čísla dokladu nebo jména partnera.
- Zaškrtněte doklady a u každého částku **Uhradit** (předvyplní se zbytek řádku, nejvýš zbytek dokladu) – jde uhradit i část.
- Řádek bez partnera ho po výběru převezme (na stranu účtu), prázdný VS se doplní z jediného dokladu a prázdná částka součtem.
- Sloupec **Vyrovnání** ukazuje *Nevyrovnáno / Částečně / Vyrovnáno*. Změna partnera řádku vyrovnání zruší; **Zrušit vyrovnání** v dialogu také.
- Zaúčtování uhradí přesně vybrané doklady a částky; řádek bez vyrovnání se dál páruje jednoznačným VS. Ověřit hlídá, že položka patří partnerovi řádku, je otevřená a částky nepřesahují zbytek dokladu ani řádek.

Před vytvořením deníku ukáže výpis **Zobrazit ▾ Náhled dokladu** účetní zápisy nanečisto (banka proti partnerům a účtům, nic se neuloží); nespárovaný řádek náhled ohlásí.

Deník z bankovního výpisu má banku jako pevný protiúčet (vpravo), vlevo partner nebo účet – dimenze partnera se tak doplní z účtu řádku. U výpisu jde deník **Odpojit** (vytvořit znovu); smazání rozpracovaného deníku výpis uvolní sám.

## Výchozí dimenze a protiúčet

- **Dimenze účtu** se doplní samy: z účtu hlavní knihy, u odběratele a dodavatele z jeho karty, u banky a pokladny z jejich účtu hlavní knihy. Co účet nemá, doplní deník.
- **Dimenze protiúčtu**: vlastní výchozí dimenze protiúčtu, jinak stejné jako u účtu.
- Změníte-li účet, výchozí dimenze předchozího účtu se nahradí novými. Ručně zadané hodnoty zůstanou.
- **Název deníku** (Hlavní kniha → Názvy deníků) může mít výchozí protiúčet a výchozí dimenze řádků. Nový deník je převezme a v jeho hlavičce (Další ▾ → Hlavička) je lze pro konkrétní deník změnit.
- Bankovní deník a platby mají výchozí protiúčet **Banka**. Pokud má firma jediný bankovní účet, doplní se sám. Pokladní deník má protiúčet Pokladna.
- Na kartu účtu, dodavatele nebo odběratele z řádku skočíte přes **Ctrl+Enter** nebo **Ctrl+klik** v poli. **Esc** vás vrátí zpět do deníku.

> Doporučení: pro opakované zápisy (bankovní poplatky, nájem) si založte **název deníku s výchozím protiúčtem** – každý řádek je pak vyrovnaný sám a stačí účet, text a částka. Velké množství řádků (výpis, mzdy) nahrajte **Importem** z Excelu; čísla dokladů se doplní při Ověřit.

## Účtový rozvrh

- Účty jsou šestimístné (syntetika + analytika); zadáte-li jen 3 číslice, doplní se `000`.
- Na saldokontní, bankovní, pokladní a DPH účty ručně zapsat nejde – účtují na ně doklady modulů.
- **Duplikovat** na účtu založí kopii s volným číslem.

## Kontrola

- [Účetní doklady](/gl/voucher) a [Zápisy](/gl/trans); na každém dokladu modulu tlačítka **Doklad HK** a **DPH**.
- Reporty hlavní knihy (předvaha, obratovka) najdete na ploše modulu Hlavní kniha.
