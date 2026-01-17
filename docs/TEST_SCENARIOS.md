# SHANON TEST SCENARIOS
> Přehled klíčových testovacích scénářů pro aplikaci.

## 1. Modul: DocuRef (Přílohy)

### 1-A: Připojení souboru k požadavku
1. Otevřete modul **Requests** (Požadavky).
2. V tabulce **označte** kliknutím jeden záznam (zaškrtněte checkbox nebo klikněte na řádek).
3. V horní liště (Action Bar) klikněte na ikonu **Sponky** (Přílohy).
4. Klikněte na tlačítko **Přidat**.
5. Vyberte záložku **Soubor**, zvolte soubor z disku (např. PNG, PDF) a potvrďte.
6. **Ověření:**
   - [ ] Drawer se zavře nebo zůstane otevřený a v seznamu se objeví nový soubor.
   - [ ] Po zavření Draweru: Ikona sponky má červený "Badge" s číslem (např. 1).

### 1-B: Vytvoření textové poznámky
1. Otevřete panel Příloh pro vybraný záznam.
2. Klikněte na tlačítko **Přidat**.
3. Přepněte na záložku **Poznámka**.
4. Zadejte text: "Testovací poznámka k požadavku".
5. Klikněte na **Uložit**.
6. **Ověření:**
   - [ ] Poznámka se zobrazí v seznamu příloh.

### 1-C: Stažení a smazání
1. U existující přílohy klikněte na ikonu **Stáhnout**.
   - [ ] Soubor se začne stahovat.
2. Klikněte na ikonu **Odpadkového koše**.
   - [ ] Zobrazí se potvrzovací dialog.
   - [ ] Po potvrzení příloha zmizí ze seznamu.

### 1-D: Neaktivní tlačítko (Negativní test)
1. Otevřete **Requests** a ujistěte se, že **nemáte vybraný žádný řádek**.
2. Podívejte se na ikonu Sponky.
3. **Ověření:**
   - [ ] Ikona je zašedlá (neaktivní) a nejde na ni kliknout.
   - [ ] (Popis: Přílohy lze spravovat pouze pro konkrétní záznam.)

## 2. Modul: System Parameters (Konfigurace)

### 2-A: Změna globálního parametru
1. Přejděte do **System -> Settings -> Global Params**.
2. Najděte parametr `DOCUREF_STORAGE_PATH`.
3. Klikněte na ikonu tužky (Edit).
4. Změňte hodnotu (např. na `uploads/test`).
5. Uložte.
6. **Ověření:**
   - [ ] Hodnota v tabulce se aktualizovala.
   - [ ] (Backend ověření: data jsou v `sys_parameters` tabulce).

## 3. Modul: Change Requests (Požadavky)

### 3-A: Vytvoření nového požadavku
1. Klikněte na **Nový**.
2. Vyplňte Předmět a Prioritu.
3. Uložte.
4. **Ověření:**
   - [ ] Nový záznam se objeví v gridu.
