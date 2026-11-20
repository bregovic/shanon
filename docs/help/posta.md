---
title: Odesílání dokladů e-mailem
module: int
objects: int.mail, int.connection, org.entity
order: 20
summary: Pošta dokladů (Systémová pošta Shanonu nebo vlastní SMTP), šablona e-mailu v Organizaci, odeslání faktury, zálohy a účtenky s PDF, příznak odeslání, testovací prostředí.
---
## Pošta dokladů

Každá firma má ve výchozím nastavení napojení **POSTA – Systémová pošta Shanonu** ([Napojení](/int/connection)):
e-maily odcházejí z adresy Shanonu, **jako odesílatel se ukáže název firmy** a **odpovědi chodí na e-mail z
[Organizace](/org/entity)**. Nic se nenastavuje a funguje vždy.

Chcete posílat z vlastní schránky? [Napojení](/int/connection) → **Nový**: druh **Pošta (e-mail)**, ovladač **SMTP server**
(má pak přednost před Systémovou poštou):

| Pole | Příklad |
|---|---|
| Server SMTP | `smtp.seznam.cz`, `smtp.gmail.com`, `smtp.office365.com` |
| Zabezpečení / Port | STARTTLS 587, nebo SSL/TLS 465 |
| Uživatel, Heslo | přihlášení ke schránce (u Gmailu heslo aplikace) |
| Odesílatel | e-mail a jméno, které uvidí odběratel |

> Na serveru Shanonu (Railway) je odchozí SMTP blokované — vlastní SMTP funguje jen na vlastním hostingu. Na Railway
> používejte Systémovou poštu.

## Šablona e-mailu

V [Organizaci](/org/entity) ve skupině **Šablona e-mailu dokladů** je předmět a text pro **fakturu**, **zálohovou fakturu**
a **účtenku** a **podpis**. Výchozí nastavení je předvyplní obecnými texty, upravte je podle sebe. Proměnné:
`{num}` číslo dokladu, `{amount}` částka, `{currency}` měna, `{due}` splatnost, `{company}` název firmy, `{customer}`
odběratel. E-mail má hlavičku s názvem firmy a dole kontakty organizace (adresa, telefon, e-mail, web). Podpis u napojení
pošty (pole *Podpis*) má přednost před podpisem organizace.

## Odeslání dokladu

1. Na vydané faktuře, záloze nebo **účtence** (i v seznamu účtenek) → **Tisk ▾ → Odeslat e-mailem**. V pokladně rovnou
   po prodeji (zadáte adresu a Odeslat).
2. Otevře se **koncept**: příjemce z odběratele (pole *E-mail pro doklady*, jinak e-mail v adresáři), předmět a text
   ze šablony a v **Přílohách** PDF dokladu (faktura obsahuje ISDOC).
3. Upravte příjemce (víc adres oddělte čárkou), kopii nebo text, případně přidejte další přílohu → **Odeslat**.
4. Na dokladu se vyplní **Odesláno e-mailem** (kdy) a **Odesláno na** (komu). Záznam je v [Odeslané poště](/int/mail)
   a v protokolu napojení.

## Testovací prostředí

Se zapnutým [Testovacím prostředím](/int/test-env) jde pošta přes **TEST-MAIL**: zprávu dostane **přihlášený
uživatel** (předmět začíná `[TEST]`, nahoře je, komu byla určena), zákazník nic. Na dokladu je pak *Odesláno na:
vaše adresa (test místo …)*.

## Na co si dát pozor

- U zálohy po přijetí platby se posílá daňový doklad k platbě.
- Odeslaný e-mail už nejde měnit; pro opravu pošlete nový.
- Nepovede-li se odeslání (adresa, server), koncept zůstane s chybou – opravte a pošlete znovu.
