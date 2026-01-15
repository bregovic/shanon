# Project Blueprint & Context Prompt

## Core UX Principles

### 1. Immediate Reactivity & Data Consistency (CRITICAL)
**Rule:** Any create, edit, or delete action performed by the user must be **immediately reflected** in the user interface (lists, overviews, grids), showing the current, up-to-date values.

**Implementation Logic:**
- **Instant Feedback:** Upon successful form submission, the application MUST automatically re-fetch the relevant data list or update the local state optimistically.
- **Cache Busting:** Ensure API calls fetch fresh data. Use timestamp query parameters (e.g., `?_=${Date.now()}`) for GET requests following an update to bypass browser caching.
- **State Management:** Ensure that list components (DataGrids) re-render with the new data prop. Verify that `useEffect` dependencies correctly trigger updates.

### 2. Aesthetics & Design
- Maintain high-quality, premium aesthetics.
- Use Fluent UI components consistently.
- Ensure responsive and intuitive layouts.

### 3. Attribute Management
- Attributes are a key part of the DMS. Any changes to attribute definitions (Name, Options, Type) must propagate immediately to all views, including the Settings list and the Review interface.
