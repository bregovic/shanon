---
title: Aplikace Portál – zaměstnanci a dodavatelé
module: hr
objects: hr.employee, int.portalContact, int.portal
order: 10
summary: Instalovatelná aplikace pro zaměstnance (účtenky k proplacení) a dodavatele (faktury) — přihlášení, pozvánky, focení dokladů, zpracování ve Shanonu.
---
## Co to je

**Portál** je samostatná aplikace (do mobilu i počítače) pro lidi, kteří nemají účet ve Shanonu:

- **Zaměstnanci** posílají účtenky, které zaplatili za firmu (vyfotí je mobilem), a doklady pro firmu.
- **Dodavatelé** posílají faktury, zálohové faktury, objednávky a jiné doklady.

Portál jen sbírá doklady. Kontrola, vytěžení, zalistování, schválení a zaúčtování probíhají ve Shanonu (Doklady ke
zpracování → workflow). Adresa portálu organizace je `/p/<kód organizace>`, pozvánky ji obsahují.

## Nastavení

1. **Integrace → [Dodavatelské portály](/int/portal)** – u portálu firmy v sekci *Aplikace Portál* zapněte
   **Dodavatelé v aplikaci Portál** a/nebo **Zaměstnanci v aplikaci Portál**. Platí i limity portálu (velikost a počet
   souborů, doklady za den) a jeho odpovědná osoba (dostává úkoly k dokladům).
2. **Zaměstnanci → [Zaměstnanci](/hr/employee)** – karta s **osobním číslem**, jménem, e-mailem a úvazkem od–do.
   Stejné osobní číslo v jiné firmě = tentýž člověk s jedním přihlášením; v Portálu si firmu vybere.
   Tlačítko **Poslat pozvánku do Portálu** pošle odkaz na nastavení hesla (platí 7 dní).
3. **Integrace → [Kontakty portálu](/int/portalContact)** – povolené e-maily dodavatelů ve firmě (jméno a dodavatel
   nepovinně). **Poslat pozvánku do Portálu** pošle odkaz, který rovnou přihlásí.

## Přihlášení

- **Zaměstnanec:** osobní číslo + heslo (aspoň 8 znaků). Po 5 chybných pokusech je přihlášení na 15 minut zablokované.
  Zapomenuté heslo = nová pozvánka z karty zaměstnance.
- **Dodavatel:** zadá e-mail a přijde mu přihlašovací odkaz (platí 20 minut, jen jednou) — heslo nemá. Odkaz přijde
  jen na e-mail z Kontaktů portálu; na neznámý e-mail nepřijde nic a stránka odpoví stejně, takže nejde zjistit, které
  adresy znáte. Dodavatel vidí jen firmy, kde má zapnutý kontakt. IČO nezadává — bere se z dokladu.
- Přihlášení platí 30 dní. Vypnutím karty zaměstnance (Aktivní, Přístup do Portálu, konec úvazku) nebo kontaktu přístup
  hned končí.

## Posílání dokladů

1. Vyberte firmu (má-li jich víc) a **co posíláte**. Portál si poslední volbu pamatuje.
2. **Vyfotit** – fotka se hned otevře k úpravě: kolečka posuňte do rohů dokladu → fotka se **ořízne a narovná**,
   **Otočit** po 90°, **Zlepšit čitelnost** (odstíny šedi, kontrast). Nebo **Vybrat soubor** (PDF, ISDOC, obrázek).
3. Nepovinná **poznámka** a **Odeslat** – přijde číslo dokladu.

Doklad se objeví v [Dokladech ke zpracování](/int/document) se zdrojem *Aplikace Portál* a hned se vytěží. Protože
odesílatel je ověřený, připravený doklad se zalistuje sám (workflow WF-DOKLADY), jinak vznikne úkol odpovědné osobě portálu.

## Účtenky zaměstnanců (proplacení)

Účtenka k proplacení se zalistuje jako přijatý doklad **na zaměstnance**, ne na obchod z účtenky: při prvním dokladu se
zaměstnanci založí dodavatel s účtovacím profilem **ZAM (333)** a uloží se na jeho kartu. Obchod je v popisu dokladu.
Proplacení = platební příkaz na dodavatele zaměstnance. *Doklad pro firmu* (faktura na firmu) se zpracuje jako běžný
přijatý doklad bez proplacení.

## Instalace aplikace

V Portálu (i ve Shanonu v **Mém nastavení**) je tlačítko **Nainstalovat aplikaci** – v Chromu, Edgi a na Androidu
nabídne instalaci, na iPhonu ukáže návod *Sdílet → Přidat na plochu*. Shanon a Portál jsou dvě samostatné aplikace
s vlastní ikonou.
