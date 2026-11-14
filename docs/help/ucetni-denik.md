---
title: Účetní deník a hlavní kniha
module: gl
objects: gl.journal, gl.journalLine, gl.account, gl.voucher, gl.trans
order: 10
summary: Ruční zápisy, druhy účtů (odběratel, dodavatel, banka), ověření a zaúčtování; účtový rozvrh.
---
## Deník

1. [Deníky](/gl/journal) → **Nový**, vyberte **název deníku** (určuje druh a číslování dokladů) a datum.
2. Řádky v mřížce: **druh účtu** (hlavní kniha, odběratel, dodavatel, banka, pokladna), účet, **MD** nebo **D**, text, případně **protiúčet** na stejném řádku.
   - Odběratel / dodavatel zapíše i do salda; úhrada s **VS** spáruje fakturu.
3. **Ověřit** – kontrola vyrovnanosti, účtů, období a dimenzí bez zaúčtování. Výsledek je v poli *Kontrola*.
4. **Zaúčtovat** – vzniknou účetní doklady podle nastavení deníku (po vyrovnání, jeden za deník, řádek).

## Účtový rozvrh

- Účty jsou šestimístné (syntetika + analytika); zadáte-li jen 3 číslice, doplní se `000`.
- Na saldokontní, bankovní, pokladní a DPH účty ručně zapsat nejde – účtují na ně doklady modulů.
- **Duplikovat** na účtu založí kopii s volným číslem.

## Kontrola

- [Účetní doklady](/gl/voucher) a [Zápisy](/gl/trans); na každém dokladu modulu tlačítka **Doklad HK** a **DPH**.
- Reporty hlavní knihy (předvaha, obratovka) najdete na ploše modulu Hlavní kniha.
