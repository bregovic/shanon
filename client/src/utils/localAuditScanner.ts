
// src/utils/localAuditScanner.ts

export interface AuditResult {
    scanned_count: number;
    missing_translations: { key: string; files: string[] }[];
    unused_translations: { key: string; value: string }[];
    hardcoded_candidates: { file: string; text: string }[];
}

export async function runLocalAudit(p0: any): Promise<AuditResult> {
    const dirHandle = p0; // Expecting FileSystemDirectoryHandle (any to avoid rigorous type checks if types unavailable)

    let scannedCount = 0;
    const usedKeys: Record<string, string[]> = {};
    const definedKeys: Set<string> = new Set();
    const hardcodedCandidates: { file: string; text: string }[] = [];

    // Regex patterns (Same as PHP)
    const tPattern = /[^a-zA-Z]t\(['"]([^'"]+)['"]\)/g;
    const hardcodedPattern = />\s*([A-Za-zěščřžýáíéúůĚŠČŘŽÝÁÍÉÚŮ0-9\s,.!?-]+)\s*</g;
    // Basic key finder for TS file (key: 'val' or "key": "val")
    const keyDefPattern = /['"]?([a-zA-Z0-9_.]+)['"]?\s*:\s*['"`]/g;

    async function scanDir(handle: any, path: string) {
        for await (const entry of handle.values()) {
            const relativePath = path ? `${path}/${entry.name}` : entry.name;

            if (entry.kind === 'file') {
                const name = entry.name.toLowerCase();

                // 1. Parse Translation Definitions
                if (name === 'translations.ts') {
                    const file = await entry.getFile();
                    const text = await file.text();
                    let match;
                    while ((match = keyDefPattern.exec(text)) !== null) {
                        definedKeys.add(match[1]);
                    }
                }

                // 2. Scan TSX/TS Files
                else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
                    scannedCount++;
                    const file = await entry.getFile();
                    const text = await file.text();

                    // Find usages
                    let match;
                    while ((match = tPattern.exec(text)) !== null) {
                        const key = match[1];
                        if (!usedKeys[key]) usedKeys[key] = [];
                        usedKeys[key].push(relativePath);
                    }

                    // Find Hardcoded
                    while ((match = hardcodedPattern.exec(text)) !== null) {
                        const content = match[1].trim();
                        if (content.length > 3 && isNaN(Number(content)) && !content.includes('{')) {
                            hardcodedCandidates.push({ file: relativePath, text: content });
                        }
                    }
                }
            } else if (entry.kind === 'directory') {
                if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
                    await scanDir(entry, relativePath);
                }
            }
        }
    }

    await scanDir(dirHandle, "");

    // Analyze results
    const missing: { key: string; files: string[] }[] = [];
    for (const key in usedKeys) {
        if (!definedKeys.has(key)) {
            missing.push({ key, files: Array.from(new Set(usedKeys[key])) });
        }
    }

    // (Optional) Unused keys logic could go here by reversing the check

    return {
        scanned_count: scannedCount,
        missing_translations: missing,
        unused_translations: [], // Not implemented yet
        hardcoded_candidates: hardcodedCandidates.slice(0, 100)
    };
}
