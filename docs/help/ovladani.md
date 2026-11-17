---
title: Ovládání a klávesové zkratky
module: general
order: 0
summary: Přehled zkratek po oblastech (všude, seznam, formulář, mřížka řádků, výběr, datum) a doporučení, jak pracovat rychle z klávesnice.
---
## Všude

| Klávesy | Co udělají |
|---|---|
| `Ctrl+K` nebo `/` | Hledání v menu a v nápovědě (napište část názvu, Enter otevře) |
| `Ctrl+S` | Uložit |
| `Esc` | Zavřít nabídku nebo dialog, jinak zpět (ze záznamu do seznamu) |
| `Tab` / `Shift+Tab` | Další / předchozí pole |

## Seznam (grid)

| Klávesy | Co udělají |
|---|---|
| `Shift+N` | Nový záznam |
| `Shift+R` | Obnovit seznam |
| `Shift+D` | Smazat vybrané (vždy s potvrzením) |
| `Enter` | Otevřít vybraný řádek (stejně jako dvojklik) |
| zaškrtnutí u řádků | Výběr více řádků pro hromadnou akci |

Číslo nebo kód záznamu je odkaz – klik ho rovnou otevře. Filtr a řazení jsou v menu záhlaví sloupce.

**Filtry a pohledy.** Nastavený filtr ukáže nad seznamem lištu „Filtrováno: …“ s tlačítkem **Zrušit filtry**. Filtr platí, dokud seznam neopustíte na jinou agendu (návrat z detailu záznamu ho zachová). **Uložit pohled** uloží filtry a řazení pod názvem do oblíbených, volitelně do složky (např. „Objednávky“); pohled otevřete z menu oblíbených (hvězdička v hlavičce). **Upravit oblíbené…** v tom menu přejmenuje, přesune do složky nebo odebere oblíbené. U zaškrtávacích polí filtr `""` najde nezaškrtnuté a `!""` zaškrtnuté. Sloupec s odkazem (kategorie, dodavatel…) jde filtrovat podle kódu i názvu.

**Sloučit.** U položek označte v seznamu dva a více záznamů stejného výrobku a zvolte **Sloučit**: ponechá se položka s nejnižším číslem, prodeje, faktury, slevy a přílohy ostatních se převedou na ni a ostatní se smažou. Cena je vyšší z cen, dodavatel zůstane jen shodný, z názvu zmizí „(dodavatel)“. Sloučit nejde vrátit.

## Formulář

| Klávesy | Co udělají |
|---|---|
| `Shift+S` nebo `Ctrl+S` | Uložit |
| `Esc` | Zpět do seznamu |

Nový záznam dá kurzor do prvního povinného nevyplněného pole. Co uložení doplní (cena z položky, číslo deníku, číslo dokladu), je vidět už před uložením – čísla z řady jsou do uložení jen předběžná. U nového dokladu klik na předběžné číslo doklad uloží a otevře řádky.

## Mřížka řádků (deníky, řádky dokladů)

| Klávesy | Co udělají |
|---|---|
| `Enter` | Další pole; na posledním poli uloží řádek |
| `Shift+Enter` | Předchozí pole |
| `↓` na posledním řádku | Uložit řádek a založit nový |
| `↑` / `↓` | Předchozí / další řádek |
| `Ctrl+Shift+D` | Dialog dimenzí účtu a protiúčtu |
| `Shift`+klik na zaškrtnutí | Vybrat rozsah řádků (pak Smazat vybrané) |

V deníku se po otevření kurzor postaví do **Druhu účtu**. Nový řádek přebírá datum, číslo dokladu a text z předchozího a u nevyrovnaného dokladu nabídne dorovnávací částku. Řádky nevyrovnaného dokladu jsou zvýrazněné, vyrovnanost zkontroluje **Ověřit**. Dimenze a protiúčet se doplní výchozí (účet, dodavatel, název deníku).

Záložky nad řádky: **Obecné** a **Dimenze** ukazují podrobnosti vybraného řádku místo mřížky. Tam platí `↑` / `↓` = předchozí / další řádek, `Enter` / `Shift+Enter` = další / předchozí pole, `Esc` = zpět na řádky. V záložce Dimenze `Enter` za poslední dimenzí přejde na další řádek.

## Výběr hodnoty (lookup)

| Klávesy | Co udělají |
|---|---|
| psaní | Hledá podle kódu i názvu (u odběratelů a dodavatelů podle jména) |
| `*` + číslo | Hledá podle čísla (např. `*1002`) |
| `Alt+↓` | Rozbalit nabídku |
| `Ctrl+Enter` nebo `Ctrl`+klik | Otevřít kartu vybrané hodnoty (dodavatel, účet…); `Esc` vrátí zpět |
| `↑` / `↓`, `Enter` | Vybrat v nabídce a potvrdit |

Nabídka ukazuje jen hodnoty, které se do pole hodí (např. jen názvy deníků daného druhu). Hodnota, kterou jste naposledy vybrali, se u nového záznamu nabídne znovu (název deníku).

## Datum

| Napíšete | Dostanete |
|---|---|
| `d` (nebo `t`, `dnes`) | dnes |
| `d+1`, `d-7`, `+3` | posun o dny od dneška |
| `15` | 15. tohoto měsíce |
| `1511` | 15. 11. letos |
| `151126`, `15112026`, `15.11.` | celé datum |

## Doporučení

- **Ruce na klávesnici:** v mřížce stačí `Enter` dopředu, `Shift+Enter` zpět a `↓` pro nový řádek – myš nepotřebujete.
- **Pište zkratky:** datum `d`, účet jen prvními číslicemi (`518` → vyberte šipkou), odběratele jménem.
- **Nejdřív náhled:** před zaúčtováním faktury nebo deníku použijte **Zobrazit ▾ → Náhled dokladu** (zápisy i DPH, nic se neuloží), deník lze **Ověřit**.
- **Hledejte přes `Ctrl+K`** místo proklikávání menu; časté agendy si dejte do **oblíbených** (hvězdička).
- **Tisk, PDF, ISDOC a e-mail** jsou pohromadě v nabídce **Tisk ▾**, související doklady v **Zobrazit ▾**.
- **Nápověda k agendě** je pod ikonou **?** v liště formuláře.
