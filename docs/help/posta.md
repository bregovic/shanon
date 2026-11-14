---
title: Odesílání faktur e-mailem
module: int
objects: int.mail, int.connection
order: 20
summary: Nastavení poštovního serveru (SMTP), odeslání faktury nebo zálohy s PDF a ISDOC, Odeslaná pošta.
---
## Jednou na začátku

1. [Napojení](/int/connection) → **Nový**: druh **Pošta (e-mail)**, ovladač **SMTP server**.
2. Vyplňte údaje od poskytovatele pošty:

| Pole | Příklad |
|---|---|
| Server SMTP | `smtp.seznam.cz`, `smtp.gmail.com`, `smtp.office365.com` |
| Zabezpečení / Port | STARTTLS 587, nebo SSL/TLS 465 |
| Uživatel, Heslo | přihlášení ke schránce (u Gmailu heslo aplikace) |
| Odesílatel | e-mail a jméno, které uvidí odběratel |

3. Případně **Odpovědi na** (jiná adresa pro odpovědi), **Kopie odesílateli** a **Podpis** (připojí se pod každý e-mail).
4. **Test** ověří přihlášení k serveru – nic se neodešle.

> Na zkoušení stačí [Testovací prostředí](/int/test-env): napojení TEST-MAIL zprávy jen zapíše do protokolu, nikam neodejdou.

## Odeslání faktury

1. Na vydané faktuře (nebo záloze) dejte **Odeslat e-mailem**.
2. Otevře se **koncept**: příjemce z odběratele (pole *E-mail pro doklady*, jinak e-mail v adresáři), předmět a text s číslem, částkou a splatností a v **Přílohách** PDF dokladu. PDF faktury obsahuje ISDOC.
3. Upravte příjemce (víc adres oddělte čárkou), kopii nebo text, případně přidejte další přílohu.
4. **Odeslat**. Na faktuře se vyplní *Odesláno e-mailem*, záznam je v [Odeslané poště](/int/mail) a v protokolu napojení.

## Na co si dát pozor

- U zálohy po přijetí platby se posílá daňový doklad k platbě.
- Odeslaný e-mail už nejde měnit; pro opravu pošlete nový.
- Nepovede-li se odeslání (špatné heslo, adresa), koncept zůstane s chybou – opravte a pošlete znovu.
