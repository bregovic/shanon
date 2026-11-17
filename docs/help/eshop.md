---
title: E-shop
module: shop
objects: shop.shop, shop.category, shop.delivery, shop.page, shop.order, inv.item, bank.paymentMethod, int.connection
order: 10
summary: Veřejný obchod z položek a údajů firmy — nastavení, zboží, doprava, platby a vyřízení objednávek.
---
## Jednou na začátku

1. V [Organizaci](/org/entity) vyplňte **zkratku pro veřejné odkazy** (např. `uzeniny-novak`). Obchod pak bude na adrese `/<zkratka>`. Údaje o prodávajícím (název, adresa, IČO, DIČ, zápis v rejstříku) obchod bere z Organizace.
2. [E-shop](/shop/shop): název, kontakty, **vzhled** (Klasický, Minimalistický, Výkladní skříň), barva, úvodní titulek a text, logo a obrázek. **Odběratel pro objednávky z webu** je založený sám („Zákazníci e-shopu“) — adresu kupujícího nese objednávka obchodu.
3. [Stránky e-shopu](/shop/page): doplňte **obchodní podmínky, ochranu osobních údajů, reklamace a vrácení zboží** a další texty. Odstavce oddělte prázdným řádkem, nadpis začíná „## “, odrážka „- “. Bez obchodních podmínek obchod nezveřejňujte — kupující je musí odsouhlasit.
4. [Způsoby dopravy](/shop/delivery): cena s DPH, druh (osobní odběr / na adresu), zda umí dobírku. Doprava zdarma od částky se nastavuje u obchodu.
5. [Platby v e-shopu](/bank/paymentMethod?filter.eshop=true): platební metody se zaškrtnutým **Pro e-shop**. Převod potřebuje bankovní účet (QR platba). Dobírka se nabízí jen u dopravy s dobírkou, hotově jen u osobního odběru.
6. Zaškrtněte **Zveřejněno** — obchod je dostupný bez přihlášení.

## Zboží

U [položky](/inv/item) zaškrtněte **V e-shopu** a vyberte **kategorii e-shopu**. Obchod bere název, popis, obrázek, cenu a slevy z položky; zboží na váhu se objednává po desetinách a cena je za měrnou jednotku. [Kategorie](/shop/category) mají adresu (např. `uzeniny`), pořadí a mohou být vnořené.

Se zapnutým Skladem obchod ukazuje „Skladem“ / „Na objednávku“ podle volné zásoby (zásoba − rezervace). Bez **Prodávat i bez zásoby** nejde objednat víc, než je volné.

## Objednávky

Objednávka z webu založí:

- [objednávku z e-shopu](/shop/order) s kupujícím, dopravou a platbou,
- potvrzenou **prodejní objednávku** s cenami včetně DPH (zarezervuje zboží),
- u platby převodem **zálohu** — kupující vidí účet, variabilní symbol a QR platbu a dostane potvrzení e-mailem (s napojenou poštou).

Spárovaná platba zálohy z výpisu přepne objednávku na **K vyřízení** (zvoneček upozorní). Fakturu vystavíte z prodejní objednávky (**Vytvořit fakturu**), zaúčtováním faktury se zboží vyskladní. Pak na objednávce z e-shopu **Vyřízeno**. **Zrušit objednávku** uvolní rezervaci a zruší neuhrazenou zálohu.

Ochrana: z jedné adresy jen nastavený počet objednávek za hodinu, ceny a součty počítá vždy server.

## Platba kartou, Google Pay a Apple Pay (Comgate)

1. U Comgate si založte e-shop. V klientském portálu najdete **identifikátor e-shopu (merchant)** a **heslo** pro komunikaci na pozadí; mezi povolené IP adresy zadejte adresu serveru Shanonu.
2. [Integrace → Napojení](/int/connection) → **Nový**: druh **Platba**, ovladač **Comgate**, vyplňte merchant a heslo. **Test napojení** ověří spojení a vypíše povolené platební metody.
3. **Adresu pro oznámení o zaplacení** z napojení (doplňte před ni adresu aplikace, např. `https://…/api/pay/comgate/…`) zadejte v portálu Comgate jako „Result URL“ (adresa pro oznámení).
4. **Platební metody** prázdné = všechny, které má e-shop u Comgate zapnuté; jen Google Pay a karty = `GOOGLEPAY_REDIRECT+CARD_ALL`.
5. V e-shopu se platba „Kartou, Google Pay, Apple Pay“ nabídne sama, jakmile je napojení aktivní.

Kupující po odeslání objednávky přejde na platební stránku Comgate a vrátí se na stránku objednávky. Zaplaceno je, až to potvrdí brána (oznámení se vždy ověřuje dotazem u Comgate) — objednávka pak přejde na **K vyřízení**. Nedokončenou platbu jde zopakovat tlačítkem **Zaplatit** na stránce objednávky. Peníze Comgate posílá souhrnně na bankovní účet (výplata se páruje ve výpisu ručně).

**Pokladna:** se zaškrtnutou volbou **Platba QR kódem na pokladně** nabídne pokladna u platby kartou QR kód — zákazník ho naskenuje telefonem a zaplatí kartou, Google Pay nebo Apple Pay; účtenka se vystaví po potvrzení platby. Pro pokladnu musí být v Organizaci vyplněný e-mail (Comgate ho vyžaduje).

**Testovací prostředí** (Integrace → Funkce → Testovací prostředí):

- s ostrým napojením Comgate vytvoří kopii **TEST-COMGATE** s testovacími platbami (na platební stránce Comgate si zvolíte výsledek, peníze se nestrhávají; ostré napojení je po dobu testu pozastavené),
- bez Comgate založí **TEST-GATEWAY – simulátor platební brány**: místo stránky Comgate se otevře testovací stránka s tlačítky **Zaplatit** / **Zrušit platbu**, po volbě se kupující vrátí do obchodu. Nepotřebuje žádné přístupy. Pro pokladnu zaškrtněte u napojení **Platba QR kódem na pokladně** — QR otevře stejnou testovací stránku v telefonu.
