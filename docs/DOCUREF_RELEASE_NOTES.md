=== DocuRef Attachment System ===

## 1. Description
The **DocuRef** system is a generic attachment and note management module enabled for all system records, inspired by D365 FO DocuRef.
It allows users to attach files and notes to any record (e.g. Change Requests, Orders) without modifying the record's primary table schema.

## 2. Key Features
- **Generic Linkage:** Uses `ref_table` and `ref_id` to link content.
- **Multiple Types:** Supports **Files** (Upload) and **Notes** (Text).
- **Storage Abstraction:** Configurable storage path via `sys_parameters` (Default: `uploads/docuref`).
- **UI Component:** `DocuRefButton` provides a consistent "Paperclip" icon with badge count and a drawer interface.

## 3. Test Scenarios

### Scenario 1: Attach File to Request
1. Open **Requests Page**.
2. Select a request in the grid.
3. Click the **Attachments** (Paperclip) icon in the Action Bar.
   - *Verify:* Drawer opens.
4. Click **"Přidat"** (Add).
5. Select "File" tab, choose a file (e.g. PNG image), click "Uložit".
   - *Verify:* File appears in list.
   - *Verify:* Badge on button updates count (e.g. 1).
6. Close Drawer.
   - *Verify:* Badge persists.

### Scenario 2: Add Note
1. Open Attachments drawer for a request.
2. Click **"Přidat"**.
3. Select "Note", enter text "Test Note 123", click "Uložit".
   - *Verify:* Note appears in list with text visible.

### Scenario 3: Download and Delete
1. Find an existing file attachment.
2. Click **Download** icon.
   - *Verify:* File downloads correctly.
3. Click **Delete** icon.
   - *Verify:* Confirmation dialog appears.
   - *Verify:* Item is removed from list.

## 4. Technical Details
- **Table:** `sys_docuref`
- **Component:** `src/components/DocuRef.tsx`
- **Backend:** `api-docuref.php`
