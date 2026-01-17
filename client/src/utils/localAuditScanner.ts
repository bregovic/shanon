
// src/utils/localAuditScanner.ts

export interface AuditResult {
    scanned_count: number;
    missing_translations: { key: string; files: string[] }[];
    unused_translations: { key: string; files: string[] }[];
    hardcoded_candidates: { file: string; text: string }[];
    duplicate_values: { value: string; keys: string[] }[];
    code_smells: { type: 'console' | 'todo' | 'fixme'; file: string; line: number; content: string }[];
    uniformity_issues: { type: 'html_tag' | 'style' | 'structure'; file: string; line: number; message: string }[];
}

export async function runLocalAudit(p0: any): Promise<AuditResult> {
    const dirHandle = p0;

    let scannedCount = 0;
    const usedKeys: Record<string, string[]> = {}; // key -> [file1, file2]

    // Definition tracking
    const definedKeysMap: Record<string, string> = {}; // key -> value
    const duplicateValuesMap: Record<string, string[]> = {}; // value -> [key1, key2]
    const reverseDefinedKeys = new Set<string>();

    const hardcodedCandidates: { file: string; text: string }[] = [];
    const codeSmells: { type: 'console' | 'todo' | 'fixme'; file: string; line: number; content: string }[] = [];
    const uniformityIssues: { type: 'html_tag' | 'style' | 'structure'; file: string; line: number; message: string }[] = [];

    // Regex patterns
    const tPattern = /[^a-zA-Z]t\(['"]([^'"]+)['"]\)/g;
    const hardcodedPattern = />\s*([A-Za-zěščřžýáíéúůĚŠČŘŽÝÁÍÉÚŮ0-9\s,.!?-]+)\s*</g;

    // Advanced TS Definition Parser: 'key': 'value' or key: 'val'
    // Group 1: key, Group 2: value
    const keyValPattern = /['"]?([a-zA-Z0-9_.]+)['"]?\s*:\s*['"`]([^'"`]+)['"`]/g;

    // Uniformity Patterns
    const forbiddenTags = [
        { tag: '<input', replacement: 'Input' },
        { tag: '<textarea', replacement: 'Textarea' },
        { tag: '<select', replacement: 'Dropdown' },
        { tag: '<button', replacement: 'Button' }
    ];

    async function scanDir(handle: any, path: string) {
        console.log(`Scanning directory: ${path || 'root'} (${handle.name})`);
        try {
            let itemIndex = 0;
            // @ts-ignore
            for await (const entry of handle.values()) {
                itemIndex++;
                if (itemIndex <= 5) console.log(`[DEBUG] Found item: ${entry.name} (${entry.kind})`);

                const relativePath = path ? `${path}/${entry.name}` : entry.name;

                if (entry.kind === 'file') {
                    const name = entry.name.toLowerCase();
                    // console.log(`Found file: ${relativePath}`);

                    // 1. Parse Translation Definitions (CS/EN)
                    if (name === 'translations.ts') {
                        const file = await entry.getFile();
                        const text = await file.text();
                        let match;
                        while ((match = keyValPattern.exec(text)) !== null) {
                            const key = match[1];
                            const val = match[2];

                            // We track values to find duplicates
                            if (!definedKeysMap[key]) {
                                definedKeysMap[key] = val;
                                reverseDefinedKeys.add(key);

                                if (!duplicateValuesMap[val]) duplicateValuesMap[val] = [];
                                duplicateValuesMap[val].push(key);
                            }
                        }
                    }

                    // 2. Scan TSX/TS Files
                    else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
                        scannedCount++;
                        const file = await entry.getFile();
                        const text = await file.text();
                        const lines = text.split('\n');
                        const isPage = relativePath.includes('/pages/');

                        let hasPageLayout = false;

                        // Line-based checks
                        lines.forEach((lineStr: string, idx: number) => {
                            const lineNum = idx + 1;
                            if (lineStr.includes('console.log')) {
                                codeSmells.push({ type: 'console', file: relativePath, line: lineNum, content: lineStr.trim() });
                            }
                            if (lineStr.includes('TODO') || lineStr.includes('FIXME')) {
                                const match = /\/\/\s*(TODO|FIXME)/.exec(lineStr);
                                if (match) {
                                    codeSmells.push({ type: match[1].toLowerCase() as any, file: relativePath, line: lineNum, content: lineStr.trim() });
                                }
                            }

                            // Uniformity: Forbidden Tags
                            forbiddenTags.forEach(f => {
                                // Check regular tag start or closing tag, simple heuristic
                                // Avoid matching component like <MyInput> by ensuring space, > or / after tag name
                                const tagRegex = new RegExp(`${f.tag}(\\s|>)`, 'i');
                                if (tagRegex.test(lineStr)) {
                                    uniformityIssues.push({
                                        type: 'html_tag',
                                        file: relativePath,
                                        line: lineNum,
                                        message: `Use Fluent UI <${f.replacement}> instead of HTML ${f.tag}>`
                                    });
                                }
                            });


                            // Uniformity: Complex Inline Styles (approximate check for many properties)
                            if (lineStr.includes('style={{')) {
                                // Count commas inside style block line (simple heuristic for one-liners)
                                const styleContent = lineStr.match(/style=\{\{(.*?)\}\}/);
                                if (styleContent && styleContent[1].split(',').length > 3) {
                                    uniformityIssues.push({
                                        type: 'style',
                                        file: relativePath,
                                        line: lineNum,
                                        message: `Complex inline style detected (>3 props). Use makeStyles instead.`
                                    });
                                }
                            }


                            // Uniformity: Missing Favorites path
                            if (lineStr.includes('<MenuItem') && !lineStr.includes('path=') && lineStr.includes('onClick')) {
                                uniformityIssues.push({
                                    type: 'structure',
                                    file: relativePath,
                                    line: lineNum,
                                    message: `MenuItem with logic missing 'path' prop (cannot be Favorited).`
                                });
                            }

                            if (lineStr.includes('<PageLayout')) hasPageLayout = true;
                        });

                        // Page Level Context Checks
                        if (isPage) {
                            // Check if Help Context is used in pages that likely need it
                            if ((text.includes('<ActionBar') || text.includes('ActionBar')) && !text.includes('useHelp') && !text.includes('HelpButton')) {
                                // Heuristic: If it has an ActionBar, it's a main page -> should have Help context or button
                                uniformityIssues.push({
                                    type: 'structure',
                                    file: relativePath,
                                    line: 1,
                                    message: `Page with ActionBar missing Help System integration (useHelp or HelpButton).`
                                });
                            }


                            // Structural Checks for Pages
                            const isGridPage = text.includes('<SmartDataGrid') || text.includes('SmartDataGrid');

                            if (isPage) {
                                if (!hasPageLayout && !name.includes('login') && !name.includes('register') && !name.includes('dashboard')) {
                                    // Relaxed rule: Only warn if it looks like a main page
                                    uniformityIssues.push({
                                        type: 'structure',
                                        file: relativePath,
                                        line: 1,
                                        message: `Page missing <PageLayout> wrapper.`
                                    });
                                }

                                // GRID PAGE STANDARDS
                                if (isGridPage) {
                                    if (!text.includes('useKeyboardShortcut')) {
                                        uniformityIssues.push({
                                            type: 'structure',
                                            file: relativePath,
                                            line: 1,
                                            message: `Grid Page missing Keyboard Shortcuts implementation (useKeyboardShortcut).`
                                        });
                                    }
                                    if (!text.includes('<ActionBar') && !text.includes('ActionBar')) {
                                        uniformityIssues.push({
                                            type: 'structure',
                                            file: relativePath,
                                            line: 1,
                                            message: `Grid Page missing <ActionBar> standard component.`
                                        });
                                    }
                                    // DocuRef check - a bit looser, usually part of ActionBar
                                    if (!text.includes('DocuRef')) {
                                        uniformityIssues.push({
                                            type: 'structure',
                                            file: relativePath,
                                            line: 1,
                                            message: `Grid Page might be missing Document References (DocuRef).`
                                        });
                                    }
                                }
                            }

                            // Full text checks (Regex)
                            let match;
                            while ((match = tPattern.exec(text)) !== null) {
                                const key = match[1];
                                if (!usedKeys[key]) usedKeys[key] = [];
                                usedKeys[key].push(relativePath);
                            }

                            while ((match = hardcodedPattern.exec(text)) !== null) {
                                const content = match[1].trim();
                                // Filter out empty, numbers, or template literals
                                if (content.length > 3 && isNaN(Number(content)) && !content.includes('{') && !content.includes('&nbsp;')) {
                                    hardcodedCandidates.push({ file: relativePath, text: content });
                                }
                            }
                        }
                    }
                } else if (entry.kind === 'directory') {
                    if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'build') {
                        await scanDir(entry, relativePath);
                    } else {
                        console.log(`Skipping ignored directory: ${relativePath}`);
                    }
                }
            }
            // @ts-ignore
            console.log(`Finished dir: ${path || 'root'}, found ${itemIndex} items.`);
        } catch (err) {
            console.error(`Error scanning directory ${path}:`, err);
        }
    }

    await scanDir(dirHandle, "");

    // Analyze Missing
    const missing: { key: string; files: string[] }[] = [];
    for (const key in usedKeys) {
        if (!reverseDefinedKeys.has(key)) {
            missing.push({ key, files: Array.from(new Set(usedKeys[key])) });
        }
    }

    // Analyze Unused
    const unused: { key: string; files: string[] }[] = [];
    reverseDefinedKeys.forEach(defKey => {
        if (!usedKeys[defKey]) {
            unused.push({ key: defKey, files: [] }); // No files usage
        }
    });

    // Analyze Duplicates (only if > 1 key has same value)
    const duplicates: { value: string; keys: string[] }[] = [];
    for (const val in duplicateValuesMap) {
        if (duplicateValuesMap[val].length > 1) {
            // Filter short values to avoid noise (e.g. "Ok", "No")
            if (val.length > 4) {
                duplicates.push({ value: val, keys: duplicateValuesMap[val] });
            }
        }
    }

    // Sort
    codeSmells.sort((a, b) => a.file.localeCompare(b.file));
    uniformityIssues.sort((a, b) => a.file.localeCompare(b.file));

    return {
        scanned_count: scannedCount,
        missing_translations: missing,
        unused_translations: unused,
        hardcoded_candidates: hardcodedCandidates.slice(0, 200),
        duplicate_values: duplicates,
        code_smells: codeSmells,
        uniformity_issues: uniformityIssues
    };
}
