---
title: Dodavatelský portál
module: int
objects: int.portal, int.portalUpload
order: 30
summary: Veřejná stránka, kam dodavatelé nahrají faktury, zálohy a objednávky; doklady jdou rovnou ke zpracování a vytěžení.
---
## Jak to funguje

1. Dodavatel otevře odkaz na portál, vybere **co posílá** (faktura, zálohová faktura, objednávka, jiný doklad), vyplní **IČO a název**, případně e-mail a poznámku, a **přetáhne soubory** (PDF, ISDOC, XML nebo obrázek).
2. Každý soubor se zkontroluje podle obsahu (přípona musí odpovídat skutečnému souboru), uloží se do příloh v úložišti firmy a vznikne **[Doklad ke zpracování](/int/document)** se zdrojem *Dodavatelský portál* a údaji odesílatele. Dodavatel dostane číslo dokladu.
3. Ve zvonečku se ukáže upozornění. S **Vytěžit automaticky** doklad zpracuje dávka vytěžování, jinak dáte **Vytěžit** ručně.
4. **Zalistovat** (do přijatých faktur, záloh, objednávek) vždy schvaluje člověk – doklady z portálu se samy nezalistují ani při zapnutém automatickém zalistování napojení.

## Nastavení

V [Dodavatelské portály](/int/portal) založte portál:

- **Odkaz pro dodavatele** se vygeneruje sám (obsahuje tajný klíč). Pošlete ho dodavatelům, dejte na web nebo do patičky objednávek. **Další ▾ → Nový odkaz** vytvoří nový klíč a starý odkaz přestane platit.
- **Nadpis a text** stránky, povolené **druhy dokladů**, **povinné IČO**.
- **Limity** (ochrana před zahlcením): max. velikost souboru (nejvýš 10 MB), počet souborů najednou, počet souborů za hodinu z jedné adresy a za den celkem.

## Bezpečnost

- Stránka je bez přihlášení, ale bez platného klíče nic neukáže; vyhledávače ji neindexují.
- Odmítne se soubor, který není PDF / ISDOC / XML / obrázek podle obsahu, je moc velký nebo překročí limit. Automaty zachytí skrytá past ve formuláři.
- Každý pokus je v **Protokolu nahrání** u portálu (čas, výsledek, důvod, soubor, odesílatel). IP adresa se neukládá, jen její otisk pro limity.
