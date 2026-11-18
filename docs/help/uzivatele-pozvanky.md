---
title: Uživatelé, pozvánky a náměty
module: qa
objects: qa.feedback
order: 5
summary: Pozvání nového uživatele e-mailem, reset hesla, „Nemůžu se přihlásit“ a kam psát náměty a zpětnou vazbu.
---
## Pozvat nového uživatele

1. [Uživatelé](/system/users) → **Nový**: jméno, příjmení, e-mail a firmy s rolemi.
2. **Heslo nechte prázdné** a nechte zaškrtnuté **Poslat pozvánku e-mailem**.
3. **Uložit** — uživatel dostane e-mail s odkazem **Nastavit heslo** (platí 7 dní, jen jednou), přihlašovacím jménem,
   adresami ostrého a testovacího prostředí, odkazem na nápovědu a na náměty. Po nastavení hesla je rovnou přihlášený.

Dokud si heslo nenastaví, je u něj v seznamu **Pozván — čeká na heslo** a v jeho kartě tlačítko **Poslat pozvánku znovu**.

## Reset hesla

V kartě uživatele **Resetovat heslo**: uživatel dostane odkaz na nové heslo (platí 2 dny) a je odhlášený. Dosavadní heslo
platí, dokud si nové nenastaví. Zámek po neúspěšných pokusech o přihlášení se tím zruší.

## Nemůžu se přihlásit

Na přihlašovací stránce odkaz **Nemůžu se přihlásit**: uživatel zadá e-mail a případně zprávu, správce dostane e-mail
se stavem účtu (neexistuje / neaktivní / pozvaný bez hesla / zamčený) a odpověď na něj jde přímo žadateli.

## Náměty a zpětná vazba

[Náměty a zpětná vazba](/qa/feedback) v modulu Testování a vývoj → **Nový**: druh (námět, problém, dotaz, pochvala),
stručný název, popis a ideálně adresa stránky, které se to týká. Autor a datum se doplní samy. Vývoj námět přečte,
odpoví v poli **Odpověď** a z námětu může tlačítkem **Vytvořit požadavek** založit požadavek k realizaci.

## Systémová pošta (správce aplikace)

Pozvánky, resety a žádosti o pomoc chodí přes systémovou poštu aplikace, ne přes poštu firmy. Nastavuje se v prostředí
serveru: `RESEND_API_KEY` a `SHANON_MAIL_FROM` (odesílatel na ověřené doméně, např. `Shanon <shanon@hollyhop.cz>`),
`SHANON_SUPPORT_EMAIL` (kam chodí Nemůžu se přihlásit). Na Railway jen přes Resend — odchozí SMTP je tam blokované;
`SHANON_SMTP_*` slouží jen pro vlastní hosting. Bez nastavení se e-mail neodešle a aplikace to po uložení řekne.
