---
title: Platby dodavatelům – platební příkaz
module: ap
objects: bank.paymentOrder, bank.paymentOrderLine, bank.paymentMethod, ap.trans
order: 30
summary: Návrh úhrad, kontrola v registru DPH a soubor pro banku (ABO nebo SEPA).
---
## Jednou na začátku

- V [Platebních metodách](/bank/paymentMethod) vyplňte u metody **Převodem (ABO)** nebo **Převodem (SEPA)** bankovní účet, ze kterého platíte.
- U dodavatelů může být výchozí **bankovní účet** a **platební metoda** (záložka Platební podmínky). Účty se doplňují i z registru plátců DPH.

## Postup

1. [Platební příkazy](/bank/paymentOrder) → **Nový**, zvolte platební metodu a **datum splatnosti** příkazu, případně „Faktury splatné do“.
2. **Navrhnout úhrady** – doplní otevřené faktury dodavatelů splatné do data, které ještě nejsou v jiném příkazu. Řádky můžete upravit nebo smazat.
3. Zkontrolujte sloupec **Upozornění**:
   - *Nespolehlivý plátce DPH* – za DPH byste ručili,
   - *Účet není zveřejněný v registru DPH* – platba nad limit na nezveřejněný účet také zakládá ručení.
   Platbu s upozorněním pošlete jen vědomě – zaškrtněte **Odsouhlaseno**.
4. **Vytvořit soubor pro banku** – stáhne se soubor ABO (.kpc) nebo SEPA (.xml), který nahrajete do internetového bankovnictví. Příkaz se označí jako odeslaný.
5. Úhrady se zaúčtují až **bankovním výpisem** (párování podle VS) – viz [Banka měsíčně](/help/banka-vypisy).

## Na co si dát pozor

- Formát ABO jednotlivé banky přijímají s drobnými odchylkami – první příkaz si v bankovnictví zkontrolujte.
- Spolehlivost plátců se ověřuje každý den ráno; ručně tlačítkem **Ověřit v registru DPH** na subjektu.
