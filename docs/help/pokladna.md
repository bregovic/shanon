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
- Účtenka se vytiskne podle šablony; s EET dostane kód tržby.
- **Odložený nákup** (box s QR nebo jméno) – rozpracovaný nákup odložíte a dokončíte později nebo na jiné pokladně; kód boxu stačí naskenovat do hledání.

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
- **Odeslat e-mailem**: účtenku i fakturu jde poslat jako PDF (adresa se předvyplní z odběratele). Potřebuje napojení pošty v Integraci.

## Pokladní váha

Váha se připojuje k počítači pokladny kabelem RS-232 nebo USB (převodník na sériový port) a čte se přímo z prohlížeče (Chrome nebo Edge).

1. [Integrace → Napojení](/int/connection) → **Nový**: druh **Pokladní váha**, ovladač **Váha na sériovém portu**. Vyberte **protokol** a parametry portu podle nastavení na váze:
   - **Mettler Toledo 8217 a kompatibilní** — pokladna pošle „W“, váha vrátí hmotnost,
   - **CAS ECR a kompatibilní** — dotaz ENQ / DC1 (u vah CAS typ rozhraní ECR, obvykle 9600 baud, 7 bitů, sudá parita),
   - **Plynulé posílání** — váha sama stále posílá hmotnost (řádky ST/US).
2. Na pokladně **Připojit váhu** a v nabídce prohlížeče vyberte port váhy (pokladna si ho pamatuje, tiskárna ho nepoužije).
3. U zboží na váhu se po klepnutí hmotnost načte sama — vezme se jen **ustálená** kladná hmotnost. **Zvážit** čtení zopakuje; hmotnost jde vždy zadat i ručně. Tárování a nulování se dělá na váze.

**Testovací prostředí** založí **TEST-SCALE – simulátor váhy**: pokladna se chová, jako by byla váha připojená (chvíli kolísá, pak se ustálí náhodná hmotnost).

**Ověřená váha (stanovené měřidlo):** při prodeji podle hmotnosti musí být váha ověřená a její displej viditelný pro zákazníka. Když pokladna přebírá hmotnost z váhy, posuzuje ČMI celou sestavu váha + pokladna (prohlášení výrobce o shodě sestavy, případně informativní štítek, že ověření platí jen pro váhu) — postup konzultujte s dodavatelem váhy. Pro ověřenou váhu s výpočtem ceny je protokol **Dialog 06** (viz níže).

**Panel Váha (Dialog 06):** v napojení váhy zvolte protokol **Dialog 06**, vyplňte výrobní číslo váhy a případně
**Přidat samo po ustálení** (0 = vždy potvrdí prodavač). Na pokladně pak vedle Nákupu přibude panel **Váha**: klepnutí
na vážené zboží pošle cenu za kg do váhy, váha zváží a sama spočítá cenu, panel ji ukáže a po ustálení ji
**Přidat do nákupu** vloží přesně tak, jak ji vrátila váha (pokladna cenu nepočítá). Další vážení jde až po sundání
zboží z váhy. Vážený řádek nejde upravit — jen smazat a zvážit znovu; sleva se dává samostatným řádkem. Ke každé vážené
položce se uloží hmotnost, cena za kg, cena, váha, výrobní číslo a surová odpověď váhy (doložení ceny). Prodej na
fakturu s váženým zbožím z ověřené váhy zatím nejde. Rámce Dialog 06 jsou zatím předběžné — před ostrým provozem je
ověřit podle specifikace výrobce váhy a zkouškou na skutečné váze.

