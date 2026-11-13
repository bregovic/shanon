/**
 * Ruční ověření EET 2.0 proti testovacímu prostředí Finanční správy.
 * Testovací certifikáty: eet.gov.cz → Pro vývojáře → CAEET_Playground_*.zip
 *
 *   npx tsx scripts/eet-playground.ts <soubor.p12> <heslo>
 */
import { readFileSync } from "node:fs";
import { buildEetMessage, openP12, sendEet } from "../src/modules/int/eet";

async function main() {
  const [file, pass] = process.argv.slice(2);
  const cert = openP12(readFileSync(file).toString("base64"), pass);
  console.log(`certifikát ${cert.subject}, platnost do ${cert.validTo.toISOString().slice(0, 10)}`);
  for (const verify of [true, false]) {
    const m = buildEetMessage({ eic: cert.subject, unitId: "202", posId: "TEST", seq: `T${Date.now()}`, date: new Date(), amount: "1.00" }, cert, { first: true, verify });
    const t0 = Date.now();
    console.log(verify ? "ověřovací režim" : "evidence", `${Date.now() - t0} ms`, JSON.stringify(await sendEet("playground", m.xml, 10000)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
