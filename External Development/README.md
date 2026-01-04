# SHANON External Development Protocol

This directory serves as an interface for modular development by external agents or developers.

## Structure

### 1. For Development (Export)
Place task packages here. Each task should be in its own folder (e.g., `For Development/DMS_OCR/`) and must contain:
*   **`task_description.md`**: Specific instructions for the module.
*   **`manifest_subset.md`**: Selected rules from the main project (Coding standards, UI rules).
*   **`mock_files/`**: Interfaces or empty files defining input/output.

### 2. Deployment (Import)
External agents place their finished work here (e.g., `Deployment/DMS_OCR_v1/`).
*   **Protocol**: The INTERNAL Lead Agent (Antigravity) will review these files.
*   **Rules**:
    *   No direct commits to `src` or `backend`.
    *   Code must pass linting and match the `manifest.md` style.

## Workflow Example: DMS OCR

1.  **Lead Agent** creates `For Development/DMS_OCR`.
    *   Includes `IDmsOcrService.php` (Interface).
    *   Includes `manifest.md` (Style guide).
2.  **External Agent** implements `DmsOcrService.php` based on the interface.
3.  **External Agent** saves result to `Deployment/DMS_OCR_Completed`.
4.  **Lead Agent** reviews, tests, and moves the file to `backend/services/`.
