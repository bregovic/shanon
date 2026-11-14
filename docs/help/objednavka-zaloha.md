---
title: Prodejní objednávka a záloha
module: ar
objects: ar.order, ar.orderLine, ar.advance
order: 20
summary: Objednávka → záloha → platba → daňový doklad k platbě → faktura s odpočtem zálohy.
---
## Objednávka

1. [Prodejní objednávky](/ar/order) → **Nový**, vyberte odběratele. Objednávka se uloží a dostane číslo.
2. Přidejte **řádky objednávky** (položka, množství, cena).
3. **Potvrdit** – se zapnutým Skladem se zboží zarezervuje.

## Záloha (když ji chcete)

1. Na objednávce **Vystavit zálohu** – vznikne [zálohová faktura](/ar/advance) na celou částku; částku můžete v záloze snížit.
2. **Tisk / PDF** zálohy = výzva k platbě s QR kódem. Do účetnictví zatím nic nejde.
3. Platbu spáruje **bankovní výpis** podle variabilního symbolu (viz [Banka měsíčně](/help/banka-vypisy)). Zaúčtuje se na účet záloh 324.
4. U plátce DPH vznikne s platbou **daňový doklad k přijaté platbě** (řada DZ): DPH z přijaté zálohy k datu platby. Vytisknete ho z téže zálohy – po platbě se tiskne jako „Daňový doklad“.

## Faktura

1. Na objednávce **Vytvořit fakturu** – převezme řádky a sama si doplní uhrazenou zálohu.
2. Fakturu **zaúčtujte**. Záloha se odečte i s její DPH (324 a 343 proti 311), faktura ukáže „Odečtená záloha“ a zbývá uhradit jen rozdíl.

> Faktury a zálohy objednávky najdete tlačítky v horní liště objednávky – jsou aktivní, jen když nějaké existují.

## Na co si dát pozor

- Vyfakturovanou objednávku nejde měnit. Když smažete koncept faktury, objednávka se vrátí k fakturaci.
- Záloha musí být ve stejné měně jako faktura.
- Úhradu zálohy zatím páruje jen banka (ne pokladna).
