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
   - **Připraveno** – vše sedí, lze zalistovat (chybějící dodavatel s IČO / DIČ se při zalistování založí sám),
   - **Ke kontrole** – výhrada ve sloupci *Výhrady* (nejisté vytěžení, chybí IČO i DIČ, nesedí součty, duplicita…),
   - **Chyba** – vytěžení se nepovedlo (zkuste **Vytěžit** znovu).
3. Otevřete doklad, opravte údaje nebo řádky a dejte **Zkontrolovat**.
4. **Zalistovat** – chybějícího dodavatele / odběratele založí z registru (ARES podle IČO, VIES podle DIČ, jinak z vytěžených
   údajů) a vznikne koncept faktury, zálohy nebo objednávky s řádky, DPH a přiloženým souborem.

## Automatické zpracování (workflow)

Po vytěžení převezme doklad [workflow](/wf/definition) **WF-DOKLADY**: připravený doklad (ISDOC nebo vytěžení bez
výhrad) se zalistuje sám i se založením partnera. Když údaj chybí nebo je nejistý, dostane úkol **Doplnit údaje** ten,
kdo doklad nahrál (portál → odpovědná osoba portálu, dávka → odpovědná osoba napojení), jinak vlastník firmy. Po doplnění
údajů dejte u úkolu **Hotovo** – doklad se znovu zkontroluje a zalistuje; nebo ho zalistujte ručně. Doklady z
dodavatelského portálu se samy nezalistují. Na vzniklou přijatou fakturu pak naváže schválení (viz [Úkoly](/help/workflow)).

> Dávka *Vytěžení a kontrola nových dokladů* běží každých 15 minut: vytěží nové doklady a předá workflow i vytěžené
> doklady, které ho ještě nemají.

## Na co si dát pozor

- Vytěžené údaje vždy zkontrolujte – hlavně datum zdanitelného plnění a sazby DPH.
- Napojení OCR má denní limit dokladů (u testovacího 30).
