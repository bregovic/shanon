const fs = require('fs');
const path = require('path');

// 1. Load Translations
const translationsFile = path.join(__dirname, '../client/src/locales/translations.ts');
const fileContent = fs.readFileSync(translationsFile, 'utf8');

// Extract keys (Quick & Dirty Regex parsing of the JS object)
// Assumes 'key': 'value' format
const definedKeys = new Set();
const lines = fileContent.split('\n');
lines.forEach(line => {
    const match = line.match(/^\s*'([a-zA-Z0-9_.]+)':/);
    if (match) {
        definedKeys.add(match[1]);
    }
});

console.log(`Loaded ${definedKeys.size} translation keys.`);

// 2. Scan usages
const srcDir = path.join(__dirname, '../client/src');
const usedKeys = new Set();
const missingKeys = new Set();

function scanDir(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            scanDir(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Regex for t('key')
            const regex = /[^a-zA-Z0-9]t\('([a-zA-Z0-9_.]+)'\)/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const key = match[1];
                usedKeys.add(key);
                if (!definedKeys.has(key)) {
                    missingKeys.add(key);
                    console.error(`[MISSING] ${key} in ${file}`);
                }
            }
        }
    });
}

scanDir(srcDir);

console.log('--- Report ---');
console.log(`Used Keys: ${usedKeys.size}`);
console.log(`Missing Keys: ${missingKeys.size}`);

if (missingKeys.size > 0) {
    console.log('Missing keys list:');
    missingKeys.forEach(k => console.log(`'${k}': 'TODO: Translate',`));
    process.exit(1);
} else {
    console.log('All keys are translated! ✅');
}
