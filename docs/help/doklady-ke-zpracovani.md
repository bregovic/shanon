---
title: Přijaté doklady – načtení z PDF, fotky nebo ISDOC
module: int
objects: int.document, int.documentLine
order: 10
video: 03-prijata-faktura
summary: Nahrání faktur a dalších dokladů, vytěžení, kontrola, založení dodavatele a zalistování do agendy.
---
## Co umí

- **ISDOC** (`.isdoc`, `.isdocx` nebo PDF s vloženým ISDOC) se přečte přesně a zdarma, bez vytěžování.
- **PDF bez ISDOC a fotky** se vytěží přes napojení *Vytěžování dokladů* (OpenAI) v [Integraci](/int/connection). Pro zkoušení stačí zapnout [Testovací prostředí](/int/test-env).

## Postup

1. [Načíst doklady](/int/doc-import) (také z menu Dodavatelé). Zvolte **Zalistovat jako** (nebo nechte *Rozpoznat*) a nahrajte soubory – i víc najednou.
2. Každý soubor se objeví v [Dokladech ke zpracování](/int/document) se stavem:
   - **Připraveno** – vše sedí, lze zalistovat,
   - **Ke kontrole** – výhrada ve sloupci *Výhrady* (chybí partner, nesedí součty, duplicita…),
   - **Chyba** – vytěžení se nepovedlo (zkuste **Vytěžit** znovu).
3. Otevřete doklad, opravte údaje nebo řádky a dejte **Zkontrolovat**. Když dodavatel v agendě chybí, **Založit partnera** ho vytvoří z registru (IČO/DIČ).
4. **Zalistovat** – vznikne koncept faktury, zálohy nebo objednávky s řádky, DPH a přiloženým souborem. Ten pak jen zkontrolujete a zaúčtujete.

> Dávka *Vytěžení a kontrola nových dokladů* běží každých 15 minut. V napojení OCR lze zapnout **Zalistovat připravené automaticky**.

## Na co si dát pozor

- Vytěžené údaje vždy zkontrolujte – hlavně datum zdanitelného plnění a sazby DPH.
- Napojení OCR má denní limit dokladů (u testovacího 30).
