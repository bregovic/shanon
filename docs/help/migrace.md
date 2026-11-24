---
title: Migrace firmy
module: org
objects: org.entity
order: 15
summary: Založení firmy z jednoho souboru JSON — šablona s pokyny, kontrola, spuštění a export hotové konfigurace (TEST → PROD).
---
## K čemu to je

Jedním souborem založíte firmu i s nastavením a číselníky: firma z ARES, moduly, organizace s logem, skupiny položek,
kategorie, položky s obrázky (i příznak e-shopu), dodavatelé a odběratelé podle IČO, zaměstnanci, provozovny a uživatelé.
Soubor nikdy neobsahuje doklady, hesla ani tajné údaje napojení. Stránka je v **Organizace → Funkce → [Migrace firmy](/system/migrace)**
(jen superuživatel).

## Postup

1. **Stáhnout prázdnou šablonu** – JSON s pokyny ke každé části a ke každému poli (povinné, klíč, povolené hodnoty, odkaz na
   jaký číselník). Šablona se skládá z aktuálních definic Shanonu, je tedy vždy platná.
2. Šablonu vyplňte (ručně, nebo ji dejte agentovi spolu s podklady – e-shop, ceník, seznam IČO dodavatelů):
   - `firma.ico` – IČO; vše ostatní o firmě doplní registry (sídlo, DIČ, **plátce DPH** podle registru plátců,
     finanční úřad, **CZ-NACE**, **bankovní účty** zveřejněné v registru DPH),
   - `firma.organizace` – kontakty, zkratka (adresa e-shopu a portálů), `logo` (soubor ve složce obrázků),
   - `firma.obchod` – e-shop: název, `active: true` = zveřejnit, vzhled a barva, nadpis a úvod, kontakty, logo a úvodní obrázek,
   - `moduly` – kódy z `dostupneModuly`,
   - `slozkaObrazku` – složka s obrázky a logem,
   - `data` – záznamy agend (`zaznamy`), klíče = názvy polí z `pole`, odkazy kódem,
   - `uzivatele` – e-mail, jméno, role (kódy), správce firmy, pozvat.
3. Vyberte **soubor** a **složku s obrázky** → **Zkontrolovat**. U firmy, která ještě neexistuje, se kontroluje soubor
   (formát, moduly, pole, obrázky, role); u existující firmy projdou nanečisto i všechny agendy.
4. **Spustit migraci** – kroky jdou za sebou:
   1. firma z ARES (existuje-li, údaje se obnoví),
   2. moduly s výchozím nastavením – účtový rozvrh, DPH, jednotky, skupiny… a **finanční dimenze Partner**
      (každý subjekt adresáře dostane hodnotu P00001…, jeho dodavatel a odběratel ji mají jako výchozí),
   3. organizace: kontakty, logo, **Doplnit z ARES** (NACE, plátce DPH, finanční úřad, bankovní účty do Banky),
   4. agendy v pořadí souboru – každá celá, nebo vůbec; chyba jedné nezastaví další,
   5. e-shop – vzhled, kontakty a zveřejnění (až s hotovým katalogem); výsledek ukáže adresu obchodu,
   6. uživatelé – založení / přiřazení k firmě s rolemi, pozvánka e-mailem jen s `pozvat: true`.
5. Výsledek ukáže každý krok (OK / varování / chyba, založeno / upraveno). Opravte soubor a spusťte znovu – záznamy se
   aktualizují podle klíče (číslo položky, kód, IČO, osobní číslo), nic se nezdvojí ani nesmaže.

## TEST → PROD

Firmu založte a odlaďte na TESTu, pak na ní **Exportovat konfiguraci této firmy** – vznikne stejný soubor, jen vyplněný
(obrázky jako názvy souborů ve složce `obrazky`). Na PROD ho spusťte se stejnou složkou obrázků.

## Na co si dát pozor

- Obrázek do 2 MB (PNG, JPG, WebP); celý výběr (soubor + obrázky) do 5 MB – velký katalog rozdělte do více běhů
  (nejdřív bez položek, pak položky po částech).
- Uživatel, který už je v jiné organizaci Shanonu, se nepřiřadí (e-mail je jedinečný v celé aplikaci).
- Pokladny, platby e-shopu, doprava, tiskové sestavy a napojení se migrací zatím nenastavují (výchozí nastavení modulů je založí).
- E-shop je na adrese `/<zkratka organizace>`; bez zkratky nebo bez `active: true` vrací 404.
