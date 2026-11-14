/**
 * Vytěžování dokladů přes OpenAI (Responses API, strukturovaný výstup).
 *
 * Napojení druhu „ocr“: ovladač `openai` (klíč v napojení, šifrovaně) nebo
 * `openaiTest` (testovací prostředí — klíč z proměnné prostředí serveru
 * `SHANON_TEST_OCR_KEY`, do databáze se neukládá). Denní strop dokladů
 * na napojení hlídá `dailyLimit` (počet volání v int.log za den).
 *
 * Volá se vždy mimo databázovou transakci (`src/server/doc-import.ts`).
 */
import { UserError, type RecordData } from "@/core/module";
import { revealSecret } from "@/server/secrets";

export const OCR_DRIVERS = ["openai", "openaiTest"];
export const DEFAULT_OCR_MODEL = "gpt-5-mini";
const API = "https://api.openai.com/v1";

const str = { type: ["string", "null"] };
const num = { type: ["number", "null"] };
const party = {
  type: "object",
  additionalProperties: false,
  required: ["name", "regNo", "vatId", "street", "city", "zip", "country", "bankAccount", "iban"],
  properties: { name: str, regNo: str, vatId: str, street: str, city: str, zip: str, country: str, bankAccount: str, iban: str },
};

/** Schéma odpovědi — všechna pole povinná (strict), chybějící = null. */
export const OCR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["docType", "issuer", "recipient", "docNumber", "orderNumber", "issueDate", "taxDate", "dueDate", "vs", "currency", "amountNet", "taxAmount", "amountGross", "lines", "note"],
  properties: {
    docType: { type: "string", enum: ["invoice", "advance", "order", "receipt", "creditNote", "other"] },
    issuer: party,
    recipient: party,
    docNumber: str,
    orderNumber: str,
    issueDate: str,
    taxDate: str,
    dueDate: str,
    vs: str,
    currency: str,
    amountNet: num,
    taxAmount: num,
    amountGross: num,
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "qty", "unit", "unitPrice", "taxRate", "amountNet"],
        properties: { description: str, qty: num, unit: str, unitPrice: num, taxRate: num, amountNet: num },
      },
    },
    note: str,
  },
};

export interface OcrParty {
  name: string | null;
  regNo: string | null;
  vatId: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
  bankAccount: string | null;
  iban: string | null;
}
export interface OcrResult {
  docType: "invoice" | "advance" | "order" | "receipt" | "creditNote" | "other";
  issuer: OcrParty;
  recipient: OcrParty;
  docNumber: string | null;
  orderNumber: string | null;
  issueDate: string | null;
  taxDate: string | null;
  dueDate: string | null;
  vs: string | null;
  currency: string | null;
  amountNet: number | null;
  taxAmount: number | null;
  amountGross: number | null;
  lines: { description: string | null; qty: number | null; unit: string | null; unitPrice: number | null; taxRate: number | null; amountNet: number | null }[];
  note: string | null;
}

const SYSTEM = [
  "Čteš české i zahraniční účetní doklady (faktury, zálohové faktury, objednávky, účtenky, dobropisy).",
  "Vrať údaje přesně podle dokladu, nic nedomýšlej; co na dokladu není, dej null.",
  "Data ve formátu RRRR-MM-DD. Částky jako čísla s tečkou, bez měny a mezer.",
  "issuer = vystavitel (dodavatel), recipient = příjemce (odběratel). IČO do regNo bez mezer, DIČ do vatId i s předponou země.",
  "Řádky: unitPrice a amountNet bez DPH; když doklad uvádí ceny s DPH, přepočti je na základ podle sazby. taxRate v procentech (21, 12, 0).",
  "Měna jako kód ISO (CZK, EUR). vs = variabilní symbol, jen číslice.",
].join(" ");

/** Klíč napojení (testovací z prostředí serveru, ostrý z napojení). */
export function ocrKey(conn: RecordData): string {
  const key = conn.driver === "openaiTest" ? (process.env.SHANON_TEST_OCR_KEY ?? "") : (revealSecret(conn.apiKey) ?? "");
  if (!key) throw new UserError(conn.driver === "openaiTest" ? "@INT:OcrNoTestKey" : "@INT:OcrNoKey");
  return key;
}

export interface OcrFile {
  name: string;
  mime: string;
  data: Buffer;
}

function filePart(f: OcrFile) {
  const b64 = f.data.toString("base64");
  if (f.mime === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) return { type: "input_file", filename: f.name, file_data: `data:application/pdf;base64,${b64}` };
  if (f.mime.startsWith("image/")) return { type: "input_image", image_url: `data:${f.mime};base64,${b64}` };
  throw new UserError("@INT:OcrFileType");
}

/** Vytěžit jeden doklad. `context` = kdo jsme (ať model pozná směr dokladu). */
export async function extractWithOpenAi(
  conn: RecordData,
  file: OcrFile,
  context: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ result: OcrResult; inTokens: number; outTokens: number; responseId: string }> {
  const key = ocrKey(conn);
  const res = await fetchImpl(`${API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      model: String(conn.model || DEFAULT_OCR_MODEL),
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: [{ type: "input_text", text: context }, filePart(file)] },
      ],
      text: { format: { type: "json_schema", name: "doklad", strict: true, schema: OCR_SCHEMA } },
      reasoning: { effort: "low" },
      max_output_tokens: 16_000,
    }),
  });
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !j) throw new UserError("@INT:OcrFailed", { reason: String((j?.error as { message?: string })?.message ?? `HTTP ${res.status}`).slice(0, 200) });
  const output = (j.output as { type: string; content?: { type: string; text?: string }[] }[]) ?? [];
  const text = output.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text;
  if (!text) throw new UserError("@INT:OcrFailed", { reason: String(j.status ?? "empty") });
  const usage = (j.usage as { input_tokens?: number; output_tokens?: number }) ?? {};
  return { result: JSON.parse(text) as OcrResult, inTokens: usage.input_tokens ?? 0, outTokens: usage.output_tokens ?? 0, responseId: String(j.id ?? "") };
}

/** Test napojení: model je dostupný a klíč platí (bez dokladu, nic se neúčtuje). */
export async function testOpenAi(conn: RecordData, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = ocrKey(conn);
  const model = String(conn.model || DEFAULT_OCR_MODEL);
  const res = await fetchImpl(`${API}/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new UserError("@INT:OcrFailed", { reason: String(j?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) });
  }
  return model;
}
