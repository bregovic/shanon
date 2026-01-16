
// src/utils/localAuditScanner.ts

export interface AuditResult {
    scanned_count: number;
    missing_translations: { key: string; files: string[] }[];
    unused_translations: { key: string; files: string[] }[];
    hardcoded_candidates: { file: string; text: string }[];
    duplicate_values: { value: string; keys: string[] }[];
    code_smells: { type: 'console' | 'todo' | 'fixme'; file: string; line: number; content: string }[];
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

    // Regex patterns
    const tPattern = /[^a-zA-Z]t\(['"]([^'"]+)['"]\)/g;
    const hardcodedPattern = />\s*([A-Za-zěščřžýáíéúůĚŠČŘŽÝÁÍÉÚŮ0-9\s,.!?-]+)\s*</g;

    // Advanced TS Definition Parser: 'key': 'value' or key: 'val'
    // Group 1: key, Group 2: value
    const keyValPattern = /['"]?([a-zA-Z0-9_.]+)['"]?\s*:\s*['"`]([^'"`]+)['"`]/g;

    async function scanDir(handle: any, path: string) {
        for await (const entry of handle.values()) {
            const relativePath = path ? `${path}/${entry.name}` : entry.name;

            if (entry.kind === 'file') {
                const name = entry.name.toLowerCase();

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

                    // Line-based checks
                    lines.forEach((lineStr, idx) => {
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
                    });

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
            } else if (entry.kind === 'directory') {
                if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'build') {
                    await scanDir(entry, relativePath);
                }
            }
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

    return {
        scanned_count: scannedCount,
        missing_translations: missing,
        unused_translations: unused,
        hardcoded_candidates: hardcodedCandidates.slice(0, 200),
        duplicate_values: duplicates,
        code_smells: codeSmells
    };
}
