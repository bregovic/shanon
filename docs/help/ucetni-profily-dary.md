---
title: Účtovací profily a dary
module: ap
objects: ap.postingProfile, ap.postingProfileLine, ar.postingProfile, ar.postingProfileLine, ap.parameters, ar.parameters, ap.invoice
order: 40
summary: Na jaký účet jde závazek nebo pohledávka dokladu (zaměstnanci, finanční úřad, dary) a jak evidovat poskytnutý dar.
---
## Účtovací profil

Profil určuje **účet závazků** (u odběratelů účet pohledávek), na který se doklad zaúčtuje. Bez profilu platí účet ze **skupiny** partnera, jako dřív.

1. [Účtovací profily dodavatelů](/ap/postingProfile) → **Nový**, kód a název (např. ZAM – Zaměstnanci).
2. Řádky profilu – **Platí pro**:
   - **Partner** – jen pro konkrétního dodavatele (např. zaměstnanec → 333),
   - **Skupina** – pro skupinu dodavatelů,
   - **Všechny** – pro ostatní.

   Použije se nejkonkrétnější řádek: partner, pak skupina, pak všechny.
3. Profil zvolíte na přijaté faktuře v poli **Účtovací profil**. Výchozí profil pro nové faktury lze nastavit v [Parametrech](/ap/parameters).

Úhrada z banky nebo z deníku (s VS faktury) se zaúčtuje proti stejnému účtu, na kterém závazek vznikl.

## Poskytnutý dar

1. [Přijaté faktury](/ap/invoice) → **Nový**, **Typ dokladu: Dar**, příjemce jako dodavatel. Číslo dokladu dodavatele není povinné.
2. Řádek: popis a částka. Účet se předvyplní **543100 Dary – odčitatelné od základu daně**. Dar, který odečíst nejde (dárky partnerům apod.), přepište na **543900 Dary – ostatní**.
3. Dar je **bez DPH** – nevzniká daňová transakce, nejde do přiznání k DPH ani do kontrolního hlášení.
4. Závazek jde na **379 Jiné závazky** (profil **DAR**, nastavený v Parametrech jako účtovací profil darů).
5. K dokladu přiložte **darovací smlouvu nebo potvrzení** příjemce (Přílohy) – bez něj dar od základu daně odečíst nejde.
6. Zaplaťte jako fakturu – platebním příkazem nebo z výpisu podle VS.

Na konci roku vezměte zůstatek účtu **543100** z obratové předvahy do přiznání k dani z příjmů (právnická osoba ř. 260, fyzická osoba ř. 46). Celý účet 543 je daňově neuznatelný náklad.

## Typ dokladu

- **Faktura** – běžný daňový doklad, číslo dodavatele povinné.
- **Účtenka** – zjednodušený daňový doklad: číslo dodavatele nepovinné, v kontrolním hlášení souhrnně (B.3).
- **Dar** – viz výše.
