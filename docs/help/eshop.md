---
title: E-shop
module: shop
objects: shop.shop, shop.category, shop.delivery, shop.page, shop.order, inv.item, bank.paymentMethod
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
