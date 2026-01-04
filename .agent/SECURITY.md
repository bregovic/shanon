# Security & Access Control Documentation

Tento soubor definuje bezpečnostní model aplikace Shanon. Slouží jako zdroj pravdy pro Security Identifiery (SID) a definice rolí.

## 1. Access Levels (Úrovně přístupu)

Přístupová práva jsou hierarchická. Vyšší úroveň zahrnuje nižší.

| Level | Hodnota | Kód | Popis |
|---|---|---|---|
| **NONE** | 0 | `none` | Prvek je zcela skrytý. |
| **VIEW** | 1 | `view` | Uživatel vidí data, ale nemůže editovat (Read-only). |
| **EDIT** | 2 | `edit` | Uživatel může měnit data, zakládat záznamy. |
| **FULL** | 3 | `full` | Plná práva (mazání, administrace, schvalování kritických akcí). |

## 2. Security Registry (Seznam objektů)

Každý UI prvek nebo logická sekce musí mít přidělený unikátní **Security Identifier**.

### 2.1 Moduly (Top-Level)
| ID | Identifier | Display Name | Popis |
|---|---|---|---|
| 1 | `mod_dashboard` | Dashboard | Přístup na hlavní přehled. |
| 2 | `mod_crm` | CRM | Modul pro správu klientů. |
| 3 | `mod_dms` | DMS | Document Management System. |
| 4 | `mod_requests` | Požadavky | Change Request Management. |
| 5 | `mod_projects` | Projekty | Řízení projektů. |
| 6 | `mod_system` | Systém | Konfigurace a administrace. |

### 2.2 Formuláře a Pod-sekce (Forms)
| ID | Identifier | Parent (Module) | Popis |
|---|---|---|---|
| 101 | `form_sys_diag` | Systém | Diagnostika systému a session info. |
| 102 | `form_sys_db` | Systém | Přehled databázového schématu. |
| 103 | `form_sys_logs` | Systém | Audit logy a reporty. |
| 104 | `form_crm_clients` | CRM | Seznam klientů. |
| 105 | `form_dms_upload` | DMS | Právo nahrávat nové dokumenty. |

### 2.3 Akce a Tlačítka (Actions)
Tyto identifikátory slouží pro specifická tlačítka. Pokud uživatel nemá právo, tlačítko zmizí.

| ID | Identifier | Default Level Needed | Popis |
|---|---|---|---|
| 1001 | `btn_cr_create` | EDIT | Tlačítko "Nový požadavek". |
| 1002 | `btn_sys_refresh` | VIEW | Tlačítko "Obnovit" v konfiguraci. |
| 1003 | `btn_doc_delete` | FULL | Tlačítko pro smazání dokumentu v DMS. |

## 3. Role Definitions (Standard Roles)

| Role Code | Popis |
|---|---|
| `ADMIN` | Super-uživatel, má `full` přístup všude (bypass permission check). |
| `MANAGER` | Vedoucí, obvykle `full` v modulech, `view` v systému. |
| `USER` | Běžný pracovník, `edit` ve svých datech, `view` v obecných. |
| `GUEST` | Pouze `view` ve veřejných sekcích. |

## 4. Implementační Pravidla (Pro AI a Vývojáře)

1. **Frontend Check:**
   Před vykreslením modulu, stránky nebo tlačítka VŽDY ověř oprávnění:
   ```typescript
   const { hasPermission } = useSecurity();
   if (!hasPermission('mod_crm', 'view')) return null;
   ```

2. **Backend Check:**
   API endpointy musí validovat oprávnění na začátku scriptu:
   ```php
   Security::requirePermission('mod_crm', 'view');
   ```

3. **New Features:**
   Při přidání nového formuláře přidej záznam do sekce **2. Security Registry** v tomto souboru.
