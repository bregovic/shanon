import fs from 'fs';
import { SourceMapConsumer } from 'source-map';

async function locate() {
  const mapFile = fs.readdirSync('dist/assets').find(f => f.endsWith('.js.map') && f.startsWith('index-'));
  const rawSourceMap = JSON.parse(fs.readFileSync('dist/assets/' + mapFile, 'utf8'));
  
  const consumer = await new SourceMapConsumer(rawSourceMap);
  
  // The error was on line 28 of the minified index.js. 
  // Let's check some columns around ~71969
  for (let c = 71960; c < 71980; c++) {
    const pos = consumer.originalPositionFor({
      line: 28,
      column: c
    });
    if (pos.source) {
      console.log(`Col ${c} -> ${pos.source}:${pos.line}:${pos.column} (${pos.name})`);
    }
  }
  
  consumer.destroy();
}

locate().catch(console.error);
