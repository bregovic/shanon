const fs = require('fs');
let code = fs.readFileSync('src/components/SmartDataGrid.tsx', 'utf8');

// Replace SettingsDialog imports
code = code.replace(/\/\/ Imports for Settings Dialog[\s\S]*?} from '@fluentui\/react-components';/, 'import { createTableColumn } from \'@fluentui/react-components\';');
code = code.replace(/Settings24Regular\s*,?/, '');

// Remove all states for preferences and settings between 354 and 442
code = code.replace(/\/\/ -- Preferences --[\s\S]*?\/\/ -- Reordering --/, '// -- Preferences & Reordering Stripped --\n\n    const columnSizingOptions = {};\n    const columnSizing = {};\n');

// Remove reordering logic
code = code.replace(/const \[draggedColId[\s\S]*?setDraggedColId\(null\);\n    };\n/, '');

// Remove column sizing useEffect
code = code.replace(/useEffect\(\(\) => \{\n        if \(columnConfig\?\.widths\) \{[\s\S]*?\}, \[columnConfig\?\.widths, setColumnSizing\]\);\n/, '');

// Simplify columns useMemo
code = code.replace(/const columns = useMemo\(\(\) => \{[\s\S]*?return baseCols;\n    \}, \[propColumns, columnConfig, preferenceId, t\]\);/, 'const columns = propColumns;');

// Remove handleSaveSettings
code = code.replace(/const handleSaveSettings = \(newConfig: any\) => \{[\s\S]*?catch\(\(\) => \{ \}\);\n        \}\n    \};\n/, '');

// Remove Settings Dialog rendering
code = code.replace(/\{showSettings && \([\s\S]*?\n                \)\}/g, '');

// Clean up renderCell (fixing bug + simplifying layout)
code = code.replace(/\{typeof renderCell === 'function' \? renderCell\(\) : \(extCol\?\.renderCell && typeof extCol\.renderCell === 'function' \? extCol\.renderCell\(item\) : String\(renderCell\) \+ ' IS NOT A FUNC'\)\}/g, '{typeof renderCell === \'function\' ? renderCell() : (extCol?.renderCell && typeof extCol.renderCell === \'function\' ? extCol.renderCell(rowItem) : String(renderCell) + \' IS NOT A FUNC\')}');

// Rename item: col to not shadow
code = code.replace(/\{item: col,/g, '{item: colItem,');

// Also rename 'item' to 'rowItem' where appropriate for clarity inside data rows
code = code.replace(/\{item, rowId\}/g, '{item: rowItem, rowId}');
code = code.replace(/onRowClick\?\.(\(item\))/g, 'onRowClick?.(rowItem)');
code = code.replace(/onRowDoubleClick\?\.(\(item\))/g, 'onRowDoubleClick?.(rowItem)');


// Delete GridSettingsDialog at bottom
code = code.replace(/const resolveColumnLabel = \(col: any\): string => \{[\s\S]*/, '');

fs.writeFileSync('src/components/SmartDataGrid.tsx', code);
console.log('Script ran successfully!');
