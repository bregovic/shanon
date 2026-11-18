---
title: Úkoly (Workflow)
module: wf
objects: wf.workItem, int.document, int.portal, int.connection
order: 5
summary: Pracovní položky k dokončení — Moje úkoly v Přehledu, úkoly z vytěžování dokladů, Hotovo a zrušení.
---
## Moje úkoly

Na úvodní stránce (**Přehled**) je nahoře panel **Moje úkoly** — otevřené pracovní položky, které řešíte vy, seřazené
podle termínu (po termínu červeně). Klik na název otevře doklad, ke kterému úkol patří; klik na štítek (Doplnit údaje,
Kontrola…) otevře samotný úkol. Kdo smí číst celou agendu Workflow, vidí i odkaz **Nepřiřazené úkoly**.

Nový úkol vám přijde i do zvonečku (upozornění vidíte jen vy).

## Pracovní položka

- **Druh**: Úkol, Doplnit údaje, Kontrola, Schválení.
- **Řešitel**: uživatel firmy; bez řešitele je úkol nepřiřazený.
- **Termín**, **popis**, **záznam** (doklad, ke kterému patří), **výsledek**.
- Tlačítka: **Otevřít záznam**, **Hotovo**, **Zrušit úkol** (Další). Dokončení se zapíše s datem a jménem.

Seznam: Workflow → [Moje úkoly](/wf/workItem?filter.assignedTo=me&filter.status=open), [Otevřené úkoly](/wf/workItem?filter.status=open),
[Pracovní položky](/wf/workItem). Ve sloupci Řešitel jde filtrovat jménem nebo `me` (já).

## Úkoly z vytěžování dokladů

Po vytěžení dokladu (nahrání, tlačítko Vytěžit i dávka):

1. **Jistě vytěžený a připravený doklad** (partner je v agendě, údaje a součty sedí) se **zalistuje sám** se správným
   typem (faktura, účtenka, dar, záloha, objednávka) a vznikne úkol **Zkontrolovat doklad** s odkazem na zalistovaný doklad.
   Vypnout to jde u napojení vytěžování (Integrace → Napojení → *Zalistovat jistě vytěžené automaticky*).
2. **Nejisté vytěžení** — vytěžení samo hlásí, kterými údaji si není jisté (např. částka, datum, IČO). Doklad zůstane
   **Ke kontrole** s textem „Nejisté údaje: …“ a vznikne úkol **Doplnit údaje dokladu**.
3. **Výhrady kontroly** (chybí partner, nesedí součty, duplicita) a **chyba vytěžení** → úkol **Doplnit údaje**.
4. Doklad z **dodavatelského portálu** se sám nezalistuje — vznikne úkol **Zkontrolovat a zalistovat**.

Úkol dostane ten, kdo doklad nahrál. Doklad z portálu → **odpovědná osoba portálu**; doklad bez původce (dávka) →
**odpovědná osoba napojení vytěžování**. Zalistováním dokladu se úkoly k němu uzavřou, odmítnutím zruší.

## Co bude dál

Schvalování dokladů (zálohy, faktury, objednávky, deníky, platební příkazy): typy účastníků (Účetní, Vlastník…),
účastníci na záznamu, definice s podmínkami, kroky za sebou i souběžně — požadavek CR-098.
