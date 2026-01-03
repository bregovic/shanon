# SHANON PLATFORM - DEVELOPMENT MANIFEST
> **Version:** 1.3.1
> **Philosophy:** Enterprise-grade ERP architecture inspired by D365/AX, built for modern web infrastructure.

## 1. Architektonická Vize
**Core Motto:** "Vše, co lze definovat metadaty, se nesmí programovat."

### 1.1 Klíčové Principy
*   **Metadata-Driven:** UI (Gridy, Formuláře) se generuje dynamicky.
*   **No Source Code Delivery:** Zákazník dostává Docker Image.
*   **Multi-Tenancy:** Podpora SaaS (TenantId) i On-Premise.

---

## 2. Datové Jádro (System Core)

### 2.1 Povinné Sloupce (Schema Contract)
1.  **`RecId` (BIGINT, PK)**
2.  **`TenantId` (UUID)**
3.  **`DataAreaId` (VARCHAR 4)**
4.  **`CreatedDateTime`, `ModifiedDateTime`, `CreatedBy`, `ModifiedBy`**
5.  **`VersionId` (UUID)** for Optimistic Concurrency.

### 2.2 System Tables
*   **`SysTableId`**: Registr tabulek.
*   **`DocuRef`**: Univerzální přílohy.
*   **`SysUserSetup`**: Personalizace formulářů (skryté sloupce).

---

## 3. Core Services

### 3.1 Data Management & Office Integration
*   **Excel Export/Import:** Native backend streaming.

### 3.2 Security (RBAC & XDS)
*   **Record Level Security:** Omezování dat query politikami.
*   **Field Level Security:** Omezování přístupu ke sloupcům.

### 3.3 Audit & Logs
*   **Database Log:** Sledování změn dat (OldValue -> NewValue).

### 3.4 Number Sequences
*   Centrální generování ID (např. `INV-24-001`).

---

## 4. ALM & Change Management
Proces řízení změn je integrován přímo do vývoje platformy.

### 4.1 Change Requests (CR)
*   Každá úprava musí být evidována jako CR (Change Request).
*   **Flow:** Zadání -> Vývoj -> Testování (UAT) -> Schválení -> Nasazení.
*   Tento proces bude integrován i v samotné aplikaci pro nahlášení chyb/požadavků uživateli.

### 4.2 Automated Changelog
*   **Conventional Commits:** Commit zprávy musí dodržovat formát: `feat(sales): add new discount logic [CR-123]`.
*   **Release Notes:** Systém při buildu automaticky vygeneruje changelog ("Co je nového"), který se zobrazí uživatelům po aktualizaci.

### 4.3 Documentation & Help System
*   **Context-Sensitive Help:** Nápověda není statické PDF. Je to databáze propojená s formuláři.
*   **`SysHelpRef`**: Tabulka mapující ID formuláře/pole na článek nápovědy.
*   Uživatel stiskne "F1" nebo "?" a systém otevře kontextovou nápovědu pro aktuální obrazovku.

---

## 5. Infrastruktura (Docker)
*   **shanon-api:** PHP 8.3 + PostgreSQL Driver.
*   **shanon-web:** Nginx + React.
*   **Database:** PostgreSQL 16 (Enterprise features: JSONB, Partitioning).
*   **Updates:** Docker Pull -> Auto Migrations.

---
*Tento manifest je závazný pro veškerý vývoj projektu Shanon.*
