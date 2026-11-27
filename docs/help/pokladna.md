---
title: Pokladna – směna, prodej, zamknutí, uzávěrka
module: pos
objects: pos.register, pos.shift, pos.receipt, pos.box, int.connection
order: 10
video: 06-pokladna
summary: Otevření směny, prodej na dotykové kase, odložené nákupy, PIN a uzávěrka do účetnictví.
---
## Začátek dne

1. [Pokladna](/kasa) – vyberte pokladnu. Pokladna s **PINem** chce nejdřív čtyřmístný PIN.
2. Když není otevřená směna, otevřete ji a zadejte počáteční hotovost.

## Prodej

- Klepněte na položku (vážené zboží se ptá na hmotnost), nebo ji najděte hledáním či čtečkou EAN.
- **Platba hotově** – zadejte přijatou částku, kasa spočítá vrácení (hotovost se zaokrouhluje na koruny). **Kartou** – přes platební terminál.
- **QR platba** – zákazník zaplatí převodem: účtenka se vytiskne s **QR kódem** pro bankovní aplikaci a variabilním symbolem (číslice čísla účtenky) a je ve stavu **Čeká na platbu**. Jakmile platba přijde, bankovní výpis ji podle VS a částky spáruje a účtenka je **Zaplaceno** (seznam [Účtenky](/pos/receipt?filter.payStatus=awaiting) ukáže, co ještě čeká). Peníze jdou na bankovní účet zadaný u pokladny, jinak na výchozí účet firmy v Bance; bez bankovního účtu QR platba nejde. Do EET se QR platba neposílá (je to převod).
- Účtenka se vytiskne podle šablony; s EET dostane kód tržby.
- **Odložený nákup** (box s QR nebo jméno) – rozpracovaný nákup odložíte a dokončíte později nebo na jiné pokladně; kód boxu stačí naskenovat do hledání. Jak se box při odložení vybírá, určuje pokladna (**Výběr boxu**: kód / QR, ze seznamu aktivních boxů, nebo obojí); obsazené boxy seznam nenabídne.
- **Druh pokladny** (karta pokladny, Šablona): *Pult s váhou* (prodej, platby, váha), *Kasa bez váhy* (prodej a platby, vážené zboží
  se zadává ručně), *Vážení do boxů* (bez plateb a uzávěrky: vybraný box se plní, **Hotovo — další box** ho uloží a vybere další volný box;
  zaplatí se pak na pokladně naskenováním boxu).

## Přestávka

- **Zamknout** (vlevo od Uzávěrky) – pokladna se zamkne, směna běží dál. Odemknete stejným PINem. PIN nastavíte v [Pokladny](/pos/register).

## Konec dne

1. **Uzávěrka** – zkontrolujte souhrn (účtenky, hotovost, karty, DPH) a spočítejte hotovost v pokladně.
2. Potvrzením se směna uzavře a do účetnictví jde **jeden doklad za směnu** (tržby, DPH, hotovost / karty).

## Na co si dát pozor

- Ceny a DPH počítá vždy server podle položek – kasa ukazuje jen orientační součet.
- Neodeslané tržby EET se dosílají samy (do 48 hodin); tlačítko v liště je odešle hned.

## Známý odběratel a prodej na fakturu

- **Odběratel** v košíku → vyberte odběratele (hledání podle názvu nebo IČO).
- Zaplaceno hned (hotově, kartou): účtenka se vytiskne jako **Faktura – daňový doklad** s údaji odběratele. Do účetnictví jde uzávěrkou směny jako ostatní účtenky; doklad od 10 000 Kč s českým DIČ odběratele jde do kontrolního hlášení jednotlivě.
- **Na fakturu** (zaplatí později): vystaví se zaúčtovaná vydaná faktura s cenami s DPH a splatností odběratele — je v saldu odběratele, zaplacení se spáruje z výpisu. **Tisk faktury** otevře PDF.
- **Odeslat e-mailem**: účtenku i fakturu jde poslat jako PDF (adresa se předvyplní z odběratele), i dodatečně ze seznamu účtenek (Tisk ▾ → Odeslat e-mailem). Na účtence je pak *Odesláno e-mailem* a *Odesláno na*. Text e-mailu = šablona v Organizaci ([Odesílání dokladů e-mailem](/help/posta)).

## Oprava účtenky

- **V kase** tlačítko **Účtenky** (vedle Uzávěrky) ukáže účtenky otevřené směny:
  - **Otevřít** – účtenka se načte do nákupu. Když změníte jen odběratele, **Uložit odběratele** ho zapíše na stejnou účtenku
    (vytisknete ji znovu). Když změníte položky a zaplatíte, původní účtenka se **stornuje** a vystaví se nová (při platbě
    hotově kasa ukáže rozdíl proti původní). **Přepsat účtenku** zapíše změněné položky na **stejné číslo** bez storna –
    jen do uzávěrky a u účtenky, která nešla do EET, e-mailem ani kartou přes terminál (způsob platby zůstává; zákazníkovi
    vytiskněte novou účtenku a původní si vezměte zpět). Na účtence je pak vidět, kdy byla přepsaná.
  - **Tisk** – účtenka znovu k tisku nebo odeslání e-mailem.
  - **Stornovat** – opravná účtenka se zápornou částkou: zboží se vrátí na sklad a do EET jde záporná tržba. Peníze vraťte
    zákazníkovi stejným způsobem (kartu na platebním terminálu).
  - **Smazat** – jen u poslední účtenky směny, která nešla do EET, e-mailem ani kartou přes terminál. Číslo dostane další prodej.
- **V seznamu [Účtenky](/pos/receipt)**:
  - **Odběratel** jde změnit i po uzávěrce, ale jen do podání přiznání k DPH za dané období. Účtenka od 10 000 Kč
    s českým DIČ odběratele se tím přesune do kontrolního hlášení jednotlivě (a zpět).
  - **Způsob platby** jde změnit do uzávěrky směny (hotovost se znovu zaokrouhlí). Nejde u platby kartou přes terminál
    a u účtenky v EET, kdyby se změnila částka.
  - **Označit jako zaplacené** – QR platba zaplacená jinak, než že ji spáruje bankovní výpis.
  - Částky a položky se nepřepisují – použijte **Stornovat** a prodejte znovu.

## Tiskárna účtenek na tabletu (USB)

Termotiskárnu ESC/POS (např. Epson TM-m30III) připojenou kabelem USB k tabletu s Androidem kasa ovládá přímo z Chrome:

1. [Integrace → Napojení](/int/connection) → **Nový**: druh **Tiskárna**, ovladač **ESC/POS přes USB – tablet (Chrome)**, papír 80 / 58 mm,
   kódová stránka PC852 (čeština). Volitelně **Tisknout účtenku automaticky** a otevírání zásuvky.
2. Na tabletu otevřete kasu, ťukněte na **Připojit tiskárnu** a v nabídce vyberte tiskárnu. Chrome si ji pamatuje, příště se tiskne hned.

Když se po připojení kabelu nabídne jiná aplikace (třeba tisková služba Epson), nenastavujte ji jako výchozí pro toto zařízení –
tiskárnu by si vzala a kasa by ji neviděla.

## Tiskárna Epson v síti (tablet bez kabelu)

Epson TM se síťovým portem (LAN) kasa na tabletu ovládá přes síť, bez kabelu k tabletu. Pokladní zásuvka zůstává
zapojená v tiskárně (zdířka se symbolem zásuvky).

1. Zjistěte IP adresu tiskárny: vypněte ji, podržte **Feed** a zapněte – vytiskne nastavení sítě (IP Address). V routeru jí
   nastavte pevnou adresu (rezervace DHCP), ať se nemění.
2. [Integrace → Napojení](/int/connection) → **Nový**: druh **Tiskárna**, ovladač **Epson v síti (ePOS) – tablet (Chrome)**,
   **IP adresa tiskárny**, papír 80 mm, kódová stránka PC852, **Otevírat pokladní zásuvku**, případně **Tisknout účtenku automaticky**.
3. Na tabletu (ve stejné Wi-Fi) jednou otevřete v Chrome `https://<IP tiskárny>` a potvrďte certifikát tiskárny
   (**Rozšířené → Pokračovat**). Pak v kase **Připojit tiskárnu**; když se Chrome zeptá na přístup k zařízením v místní síti, povolte ho.

Když tiskárna neodpovídá, kasa to napíše – zkontrolujte, že je zapnutá a tablet je ve stejné síti, případně znovu potvrďte certifikát.

## Pokladní váha

Váha se připojuje k počítači pokladny kabelem RS-232 nebo USB (převodník na sériový port) a čte se přímo z prohlížeče (Chrome nebo Edge).

1. [Integrace → Napojení](/int/connection) → **Nový**: druh **Pokladní váha**, ovladač **Váha na sériovém portu**. Vyberte **protokol** a parametry portu podle nastavení na váze:
   - **Mettler Toledo 8217 a kompatibilní** — pokladna pošle „W“, váha vrátí hmotnost,
   - **CAS ECR a kompatibilní** — dotaz ENQ / DC1 (u vah CAS typ rozhraní ECR, obvykle 9600 baud, 7 bitů, sudá parita),
   - **Plynulé posílání** — váha sama stále posílá hmotnost (řádky ST/US).
2. Na pokladně **Připojit váhu** a v nabídce prohlížeče vyberte port váhy (pokladna si ho pamatuje, tiskárna ho nepoužije).
3. U zboží na váhu se po klepnutí hmotnost načte sama — vezme se jen **ustálená** kladná hmotnost. **Zvážit** čtení zopakuje; hmotnost jde vždy zadat i ručně. Tárování a nulování se dělá na váze.

**Nová váha a neznámý protokol:** [Integrace → Zkouška váhy](/int/scale-test) (Chrome nebo Edge na počítači s váhou) →
**Připojit váhu** → položte zboží → **Diagnostika**. Stránka zkusí obvyklé rychlosti, parity a dotazy běžných protokolů
a ukáže, co váha odpoví; rozpoznané nastavení uložíte do napojení váhy tlačítkem **Použít**. Ručně jde poslat i vlastní
dotaz (text nebo HEX) a sledovat komunikaci. Když váha neodpoví vůbec, zkontrolujte v nastavení váhy zapnutý výstup
RS-232 a zkuste **Jen poslouchat** a na váze tlačítko tisku.

Testovací prostředí simulátor váhy nezakládá — vždy se používá skutečná váha z napojení.

**Na pokladně:** port se povolí na každém počítači jen **jednou** (Připojit váhu nebo Zkouška váhy) — prohlížeč z bezpečnosti
nedovolí stránce sáhnout na COM port bez souhlasu; potom se pokladna připojuje sama (i po odpojení, každých 5 s). V napojení
váhy: **Přidat samo po ustálení** (výchozí 2 s, 0 = jen tlačítkem) a **Pípnout při přidání do nákupu**.

**Pořadí u ověřené váhy (Dialog 06):** nejdřív klepnout na zboží (cena za kg jde do váhy), pak ho položit. Leží-li zboží na
váze dřív, panel řekne *Zvedněte zboží z váhy a položte ho zpět* — váha přijme jen vážení, které začne po zadání ceny.

### Zásady vážení v prodeji potravin (přehled)

Orientační shrnutí, nenahrazuje předpisy ani poradenství ČMI / dodavatele váhy:

- **Ověřená váha.** Váha pro prodej podle hmotnosti je stanovené měřidlo (zákon č. 505/1990 Sb. o metrologii, vyhláška
  č. 345/2002 Sb.): musí mít označení shody (CE + M + rok) a úřední značky, **následné ověření každé 2 roky** (ČMI nebo
  autorizované středisko). Porušená plomba nebo značka = váha se nesmí používat.
- **Zákazník vidí údaje.** Displej hmotnosti, ceny za kg a ceny musí být čitelný ze strany zákazníka.
- **Váha v rovině a na nule.** Libela uprostřed, před vážením nula a ustálení; vážit jen ustálenou hmotnost.
- **Minimum (Min).** Pod minimální vážitelnou hmotností (štítek váhy) se podle hmotnosti prodávat nesmí — váha to hlásí sama.
- **Obal se neplatí.** Zákazník platí jen hmotnost potraviny: obal / sáček / misku **vytárujte** na váze (tlačítko Tare) — u
  balených potravin platí čistá hmotnost (nařízení EU č. 1169/2011, zákon č. 110/1997 Sb. o potravinách).
- **Cenu počítá váha.** U sestavy pokladna + ověřená váha s výpočtem ceny (Dialog 06) pokladna cenu jen přebírá, nepřepočítává
  a nedovolí ruční změnu váženého řádku (požadavky WELMEC 2.2 na sestavy pokladna – váha; posouzení sestavy s dodavatelem).
- **Doklad.** Na účtence je u váženého zboží hmotnost, cena za kg a cena (zákon č. 634/1992 Sb. o ochraně spotřebitele —
  správnost měření a ceny).

**Ověřená váha (stanovené měřidlo):** při prodeji podle hmotnosti musí být váha ověřená a její displej viditelný pro zákazníka. Když pokladna přebírá hmotnost z váhy, posuzuje ČMI celou sestavu váha + pokladna (prohlášení výrobce o shodě sestavy, případně informativní štítek, že ověření platí jen pro váhu) — postup konzultujte s dodavatelem váhy. Pro ověřenou váhu s výpočtem ceny je protokol **Dialog 06** (viz níže).

**Panel Váha (Dialog 06):** v napojení váhy zvolte protokol **Dialog 06**, vyplňte výrobní číslo váhy a případně
**Přidat samo po ustálení** (0 = vždy potvrdí prodavač). Na pokladně pak vedle Nákupu přibude panel **Váha**: klepnutí
na vážené zboží pošle cenu za kg do váhy, váha zváží a sama spočítá cenu, panel ji ukáže a po ustálení ji
**Přidat do nákupu** vloží přesně tak, jak ji vrátila váha (pokladna cenu nepočítá). Další vážení jde až po sundání
zboží z váhy. Vážený řádek nejde upravit — jen smazat a zvážit znovu; sleva se dává samostatným řádkem. Ke každé vážené
položce se uloží hmotnost, cena za kg, cena, váha, výrobní číslo a surová odpověď váhy (doložení ceny). Prodej na
fakturu s váženým zbožím z ověřené váhy zatím nejde. Rámce Dialog 06 jsou zatím předběžné — před ostrým provozem je
ověřit podle specifikace výrobce váhy a zkouškou na skutečné váze.

