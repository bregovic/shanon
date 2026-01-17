# SHANON DEVELOPMENT STANDARD CHECKLIST
*Use this checklist before finalizing any new page or feature.*

## 1. Security & Context
- [ ] **Multi-Org:** Does the code use `useAuth().currentOrgId`?
- [ ] **Permissions:** Are actions hidden/disabled via `hasPermission(...)`?
- [ ] **API Security:** Does the backend verify `org_id` and `tenant_id`?

## 2. Layout & Mobile
- [ ] **Responsive:** Does the page work on mobile (375px width)?
- [ ] **No Scroll:** Is horizontal scrolling avoided on main forms?
- [ ] **Touch Targets:** Are buttons easy to tap on mobile?
- [ ] **PageLayout:** Is the content wrapped in `<PageLayout>`?

## 3. Navigation
- [ ] **Logo Click:** Does clicking the Logo go to the module root?
- [ ] **Module Reset:** Does clicking the Module tab reset the view?
- [ ] **Back Button:** Is state properly managed via URL (not just useState)?

## 4. UI Components (ActionBar)
### Grid View
- [ ] **Shortcuts:** Are `Shift+N`, `Shift+R`, `Shift+F` implemented?
- [ ] **Structure:** [Menu] | [Refresh] [DocuRef] [Export] | [Funkce]
- [ ] **Refresh:** Is it icon-only with `title`?

### Detail View
- [ ] **Shortcuts:** Are `Shift+S`, `Esc`, `Enter` implemented?
- [ ] **Structure:** [Menu] | [Refresh] [DocuRef]
- [ ] **Feedback:** Do actions confirm success via Toast/MessageBar?

## 5. Coding Standards
- [ ] **Translations:** Are all labels using `t('key')`? No hardcoded text.
- [ ] **Common Labels:** Did you reuse `common.save`, `common.back`, etc.?
- [ ] **Hooks:** Is logic extracted to custom hooks if complex?
- [ ] **Comments:** Is complex logic documented?

## 6. Data Grid
- [ ] **SmartDataGrid:** Is `SmartDataGrid` used?
- [ ] **Alignment:** Text=Left, Numbers=Right, Dates=Center.
- [ ] **Filters:** Are filters working?

## 7. Help & Favorites System
- [ ] **Help Context:** Is `HelpButton` present in the context bar (if applicable)?
- [ ] **Help Content:** Is there a relevant help topic created/updated for this feature?
- [ ] **Favorites:** Do navigation items (MenuItem) have the `path` prop enabling the Favorite star?


## 8. Keyboard Shortcuts Verification
- [ ] `Esc` - Go back / Close modal
- [ ] `Enter` - Confirm / Open detail
- [ ] `Shift+N` - New record
- [ ] `Shift+R` - Refresh
- [ ] `Shift+D` - Delete
- [ ] `Shift+S` - Save
