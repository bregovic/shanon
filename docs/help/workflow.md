---
title: Úkoly a workflow
module: wf
objects: wf.workItem, wf.definition, wf.definitionStep, wf.participantType, wf.instance, int.document, int.portal, int.connection
order: 5
summary: Moje úkoly, definice workflow (automatické akce, úkoly, schválení), typy účastníků, výchozí zpracování dokladů a schválení přijatých faktur.
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
- Tlačítka: **Otevřít záznam**, **Hotovo** (u schválení **Schválit** / **Zamítnout**), **Zrušit úkol** (Další). Dokončení se zapíše s datem a jménem.

Seznam: Workflow → [Moje úkoly](/wf/workItem?filter.assignedTo=me&filter.status=open), [Otevřené úkoly](/wf/workItem?filter.status=open),
[Pracovní položky](/wf/workItem). Ve sloupci Řešitel jde filtrovat jménem nebo `me` (já).

## Definice workflow

[Definice workflow](/wf/definition) (Workflow → Nastavení) určuje, co se se záznamem stane samo:

- **Objekt** – např. `ap.invoice` (přijatá faktura), `int.document` (doklad ke zpracování).
- **Spustit při** – *Založení záznamu*, *Události modulu* (`extracted` = doklad vytěžen) nebo *Provedení akce* (id akce).
- **Podmínka** – zápis jako filtr sloupce, víc podmínek středníkem: `amountGross: >50000; docType: invoice`. Prázdná = vždy.
- **Zamčené akce** – během čekání nejdou spustit ručně (`post` = Zaúčtovat během schvalování).
- **Kroky** podle pořadí:
  - **Automatická akce** – akce objektu (`post` Zaúčtovat, `list` Zalistovat). **Předpoklad akce** (zápis jako filtr) musí
    platit, jinak – stejně jako při chybě akce – vznikne úkol **Doplnit údaje** a běh čeká. Hotovo u úkolu krok zopakuje
    (předtím spustí **Kontrolu při opakování**), ruční provedení té akce běh posune dál.
  - **Úkol** – Hotovo = další krok.
  - **Schválení** – **Schválit** = další krok, **Zamítnout** = konec (původce dostane upozornění).
  - **Podmínka kroku** – nesplněná = krok se přeskočí (např. schválení jen nad částku).
  - **Komu**: *Původce dokladu* (kdo doklad nahrál nebo založil), *Typ účastníka* nebo *Uživatel*. Když vybraný nikoho nemá,
    dostane úkol původce, případně typ účastníka kroku.

[Typy účastníků](/wf/participantType) (Vlastník, Účetní…) mají ve firmě obsazení uživatelem. [Běhy workflow](/wf/instance)
ukazují, kde který záznam čeká, se všemi úkoly; běh jde zrušit (Další → Zrušit workflow).

## Výchozí workflow nové firmy

1. **WF-DOKLADY – Zpracování dokladů z integrace** (po vytěžení): připravený doklad se zalistuje sám i se založením
   dodavatele / odběratele z ARES. Chybí-li údaj nebo je nejistý (nejisté vytěžení, chybí číslo, nesedí součty, duplicita),
   úkol **Doplnit údaje** dostane původce dokladu, jinak vlastník. Doklad z **dodavatelského portálu** se sám nezalistuje –
   úkol dostane odpovědná osoba portálu.
2. **WF-PRIJATE – Schválení přijaté faktury** (při založení): úkol **Kontrola a schválení** vlastníkovi (termín 3 dny),
   po schválení se faktura sama **zaúčtuje**. Do té doby ji ručně zaúčtovat nejde. Zamítnutá zůstane v konceptu.
   Nezdaří-li se zaúčtování (chybí údaj), dostane úkol účetní, jinak původce.

Obsaďte v Typech účastníků **Vlastníka** (a Účetní) – bez obsazení jdou úkoly původci dokladu. Workflow, které nechcete,
vypněte (pole Aktivní) nebo upravte jeho kroky.

## Úkoly z vytěžování dokladů

Chyba vytěžení (síť, napojení) založí úkol **Vytěžení dokladu selhalo** tomu, kdo doklad nahrál. Odmítnutím dokladu se
jeho úkoly i workflow zruší.

## Co bude dál

Souběžné kroky (všichni / první), účastníci přímo na záznamu, eskalace po termínu, delegování a zástupy – fáze 3 (CR-098).
