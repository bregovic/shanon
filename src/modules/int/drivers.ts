/**
 * Ovladače napojení. Každý druh má své ovladače; logika běží na serveru
 * (EET, platební terminál přes cloud) nebo v prohlížeči pokladny (tiskárna
 * ESC/POS přes Web Serial, tisk z prohlížeče — viz src/lib/escpos.ts).
 *
 * Každá komunikace s vnější službou se zapíše do protokolu int.log.
 */
import { checkDocument, createDocPartner } from "./documents";
import { testOpenAi } from "./ocr";
import { randomUUID } from "node:crypto";
import {
  UserError,
  type DataApi,
  type EventContext,
  type JobDef,
  type ObjectHandlers,
  type RecordData,
} from "@/core/module";
import { revealSecret } from "@/server/secrets";
import { newToken } from "@/server/api-token";
import { aresByIco } from "@/modules/gab/ares";
import { viesLookup } from "@/modules/gab/registry-lookup";
import { vatRegistryStatus } from "@/modules/gab/vat-registry";
import { fetchCnb, fetchEcb } from "@/modules/sys/currency";
import { registry } from "@/registry";
import {
  EET_RESEND_HOURS,
  buildEetMessage,
  openP12,
  sendEet,
  takeLastExchange,
  type EetCert,
  type EetEnvironment,
  type EetResult,
} from "./eet";

export const DRIVERS: Record<string, string[]> = {
  ocr: ["openai", "openaiTest"],
  eet: ["eet2", "eetSimulator"],
  printer: ["browser", "escposSerial"],
  payment: ["manual", "sumup", "simulator"],
  api: ["rest"],
  service: ["ares", "cnb", "ecb", "vies", "dphreg"],
};

const today = () => new Date().toISOString().slice(0, 10);
const clip = (s: string, n = 250) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;

export async function writeLog(
  data: DataApi,
  conn: RecordData,
  op: string,
  status: "ok" | "pending" | "error",
  x: {
    reference?: string | null;
    externalId?: string | null;
    message?: string | null;
    detail?: string | null;
  } = {},
) {
  return data.create("int.log", {
    connectionId: conn.id,
    operation: op,
    status,
    reference: x.reference ?? null,
    externalId: x.externalId ? clip(x.externalId) : null,
    message: x.message ? clip(x.message) : null,
    detail: x.detail ?? null,
  });
}

async function setCheck(data: DataApi, conn: RecordData, result: string) {
  await data.update("int.connection", String(conn.id), {
    lastCheckAt: today(),
    lastResult: clip(result),
  });
}

/** Aktivní napojení pro pokladnu (konkrétní má přednost před společným). */
export async function connectionsFor(
  data: DataApi,
  registerId: string,
): Promise<Partial<Record<"eet" | "printer" | "payment", RecordData>>> {
  const all = (
    await data.find("int.connection", { active: true }, { take: 200 })
  ).filter((c) => !c.registerId || c.registerId === registerId);
  const out: Partial<Record<"eet" | "printer" | "payment", RecordData>> = {};
  for (const kind of ["eet", "printer", "payment"] as const) {
    const list = all.filter((c) => c.kind === kind);
    const pick = list.find((c) => c.registerId === registerId) ?? list[0];
    if (pick) out[kind] = pick;
  }
  return out;
}

// ---------------------------------------------------------------------------
// EET 2.0
// ---------------------------------------------------------------------------

export function eetCertOf(conn: RecordData): EetCert {
  const p12 = revealSecret(conn.certData);
  const pass = revealSecret(conn.certPassword);
  if (!p12 || pass === null) throw new UserError("@INT:NoCertificate");
  try {
    return openP12(p12, pass);
  } catch {
    throw new UserError("@INT:BadCertificate");
  }
}

async function companyDic(
  data: DataApi,
  companyId: string | null,
): Promise<string> {
  const c = companyId ? await data.get("sys.company", companyId) : null;
  const dic = String(c?.vatId ?? "")
    .replace(/\s/g, "")
    .toUpperCase();
  if (!/^CZ\d{8,10}$/.test(dic)) throw new UserError("@INT:NoCompanyDic");
  return dic;
}

/**
 * DIČ do zprávy EET: na Playgroundu DIČ testovacího certifikátu (veřejné
 * testovací certifikáty patří fiktivním DIČ), na ostrém prostředí DIČ firmy.
 */
async function eetDic(data: DataApi, companyId: string | null, conn: RecordData, cert: EetCert): Promise<string> {
  if ((conn.environment ?? "playground") === "playground" && cert.subject) return cert.subject;
  return companyDic(data, companyId);
}

function eetMessageText(r: EetResult): string {
  switch (r.status) {
    case "ok":
      return `POK ${r.pok}${r.warnings.length ? ` · ${r.warnings.join("; ")}` : ""}`;
    case "verified":
      return `OK${r.warnings.length ? ` · ${r.warnings.join("; ")}` : ""}`;
    case "error":
      return `${r.code}: ${r.message}`;
    case "timeout":
      return r.message;
  }
}

/**
 * Evidence účtenky. Výsledek se uloží na účtenku (stav, POK) a do protokolu.
 * Nevyjde-li to včas, účtenka zůstane „čeká“ a pošle se znovu (resendPending).
 */
export async function eetRegisterReceipt(
  data: DataApi,
  companyId: string | null,
  conn: RecordData,
  receipt: RecordData,
  first: boolean,
) {
  let result: EetResult = {
    status: "error",
    code: 0,
    message: "",
    retry: false,
    txId: null,
  };
  let uuid: string | null = null;
  let ms: number | null = null;
  let exchange: { request: string; response: string | null; status: number } | null = null;
  // simulátor (testovací prostředí): testovací FIK, nic se neodesílá
  const simulated = conn.driver === "eetSimulator";
  if (simulated) {
    uuid = randomUUID();
    result = {
      status: "ok",
      pok: `TEST-${uuid.slice(0, 8).toUpperCase()}`,
      test: true,
      warnings: [],
      txId: null,
    };
  }
  if (!simulated)
    try {
      const cert = eetCertOf(conn);
      const eic = await eetDic(data, companyId, conn, cert);
      const msg = buildEetMessage(
        {
          eic,
          unitId: String(conn.unitId),
          posId: String(conn.posId),
          seq: String(receipt.receiptNum),
          date: new Date(String(receipt.createdAt)),
          amount: String(receipt.amountPaid),
        },
        cert,
        { first, verify: false },
      );
      uuid = msg.uuid;
      const t0 = Date.now();
      result = await sendEet(
        (conn.environment as EetEnvironment) ?? "playground",
        msg.xml,
      );
      ms = Date.now() - t0;
      exchange = takeLastExchange();
    } catch (e) {
      const message =
        e instanceof UserError
          ? e.label
          : e instanceof Error
            ? e.message
            : String(e);
      result = { status: "error", code: 0, message, retry: false, txId: null };
    }
  const status =
    result.status === "ok"
      ? "sent"
      : result.status === "timeout" ||
          (result.status === "error" && result.retry)
        ? "pending"
        : "error";
  await data.update("pos.receipt", String(receipt.id), {
    eetStatus: status,
    eetPok: result.status === "ok" ? result.pok : null,
    eetMessage: result.status === "ok" ? null : clip(eetMessageText(result)),
  });
  await writeLog(
    data,
    conn,
    first ? "eet.send" : "eet.resend",
    status === "sent" ? "ok" : status === "pending" ? "pending" : "error",
    {
      reference: String(receipt.receiptNum),
      externalId:
        result.status === "ok"
          ? result.pok
          : "txId" in result
            ? result.txId
            : null,
      message: eetMessageText(result),
      // přesná zpráva a odpověď FS (podpis, BKP, chyba) — pro reklamace a řešení chyb
      detail: [
        uuid ? `uuid_zpravy=${uuid}` : null,
        conn.environment ? `prostředí=${conn.environment}` : null,
        ms !== null ? `odezva=${ms} ms` : null,
        exchange ? `HTTP ${exchange.status}` : null,
        exchange ? `\n--- zpráva ---\n${exchange.request}` : null,
        exchange?.response ? `\n--- odpověď ---\n${exchange.response}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  );
  return status;
}

/** Dodatečné odeslání neodeslaných účtenek (nejpozději do 48 h od tržby). */
export async function eetResendPending(
  data: DataApi,
  companyId: string | null,
  registerId: string,
  limit = 20,
) {
  const conns = await connectionsFor(data, registerId);
  if (!conns.eet) return { sent: 0, pending: 0 };
  const pending = await data.find(
    "pos.receipt",
    { registerId, eetStatus: "pending" },
    { take: limit, orderBy: { receiptNum: "asc" } },
  );
  let sent = 0;
  for (const r of pending)
    if (
      (await eetRegisterReceipt(data, companyId, conns.eet, r, false)) ===
      "sent"
    )
      sent++;
  const still = (
    await data.find(
      "pos.receipt",
      { registerId, eetStatus: "pending" },
      { take: 1000 },
    )
  ).length;
  return { sent, pending: still };
}

export const eetDeadline = (createdAt: string) =>
  new Date(new Date(createdAt).getTime() + EET_RESEND_HOURS * 3600_000);

// ---------------------------------------------------------------------------
// Platební terminál
// ---------------------------------------------------------------------------

const SUMUP_API = "https://api.sumup.com";

async function sumup(
  conn: RecordData,
  method: string,
  path: string,
  body?: unknown,
) {
  const key = revealSecret(conn.apiKey);
  if (!conn.merchantCode || !key) throw new UserError("@INT:SumupMissing");
  const res = await fetch(
    `${SUMUP_API}/v0.1/merchants/${encodeURIComponent(String(conn.merchantCode))}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  const text = await res.text();
  let json: RecordData = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* není JSON */
  }
  return { ok: res.ok, status: res.status, json, text };
}

export type PaymentState = {
  state: "pending" | "successful" | "failed";
  message?: string;
  ref: string;
};

/** Zahájení platby kartou na terminálu; vrací id záznamu protokolu jako odkaz. */
export async function paymentStart(
  data: DataApi,
  conn: RecordData,
  amountCents: bigint,
  reference: string,
): Promise<PaymentState> {
  if (conn.driver === "simulator") {
    const log = await writeLog(data, conn, "payment.start", "pending", {
      reference,
      externalId: `SIM-${randomUUID().slice(0, 8)}`,
      detail: `amount=${amountCents}`,
    });
    return { state: "pending", ref: String(log.id) };
  }
  if (conn.driver !== "sumup") throw new UserError("@INT:WrongDriver");
  if (!conn.readerId) throw new UserError("@INT:SumupNoReader");
  const appId = conn.affiliateAppId ? String(conn.affiliateAppId) : null;
  const affKey = revealSecret(conn.affiliateKey);
  const r = await sumup(
    conn,
    "POST",
    `/readers/${encodeURIComponent(String(conn.readerId))}/checkout`,
    {
      total_amount: {
        currency: "CZK",
        minor_unit: 2,
        value: Number(amountCents),
      },
      description: reference,
      ...(appId && affKey
        ? {
            affiliate: {
              app_id: appId,
              key: affKey,
              foreign_transaction_id: reference,
            },
          }
        : {}),
    },
  );
  if (!r.ok) {
    await writeLog(data, conn, "payment.start", "error", {
      reference,
      message: `${r.status} ${clip(r.text, 200)}`,
    });
    throw new UserError("@POS:PaymentFailed", { reason: String(r.status) });
  }
  const d = (r.json.data ?? {}) as RecordData;
  const log = await writeLog(data, conn, "payment.start", "pending", {
    reference,
    externalId: String(d.checkout_id ?? d.client_transaction_id ?? ""),
    detail: `amount=${amountCents} client_transaction_id=${d.client_transaction_id ?? ""}`,
  });
  return { state: "pending", ref: String(log.id) };
}

export async function paymentStatus(
  data: DataApi,
  conn: RecordData,
  ref: string,
): Promise<PaymentState> {
  const log = await data.get("int.log", ref);
  if (!log || log.connectionId !== conn.id)
    throw new UserError("@SYS:NotFound");
  if (log.status !== "pending")
    return {
      state: log.status === "ok" ? "successful" : "failed",
      message: (log.message as string) ?? undefined,
      ref,
    };
  let state: PaymentState["state"] = "pending";
  let message: string | undefined;
  if (conn.driver === "simulator") {
    // simulace: schválí za 3 s; částka končící ,13 Kč se zamítne
    const age = Date.now() - new Date(String(log.createdAt)).getTime();
    const cents = BigInt(/amount=(-?\d+)/.exec(String(log.detail))?.[1] ?? "0");
    if (age > 3000) {
      state = cents % BigInt(100) === BigInt(13) ? "failed" : "successful";
      message =
        state === "failed" ? "Zamítnuto (simulace)" : "Schváleno (simulace)";
    }
  } else {
    const r = await sumup(
      conn,
      "GET",
      `/readers/${encodeURIComponent(String(conn.readerId))}/checkout/${encodeURIComponent(String(log.externalId))}`,
    );
    const d = (r.json.data ?? {}) as RecordData;
    const st = String(d.status ?? d.payment_status ?? "pending").toLowerCase();
    if (st === "successful") state = "successful";
    else if (st === "failed" || st === "cancelled") {
      state = "failed";
      message = String(d.payment_failure_reason ?? st);
    }
  }
  if (state !== "pending")
    await data.update("int.log", ref, {
      status: state === "successful" ? "ok" : "error",
      message: message ?? null,
    });
  return { state, message, ref };
}

/** Platba kartou pro účtenku: musí být schválená, na stejnou částku a nepoužitá. */
export async function assertPaid(
  data: DataApi,
  conn: RecordData,
  ref: string,
  amountCents: bigint,
) {
  const log = await data.get("int.log", ref);
  const cents = BigInt(
    /amount=(-?\d+)/.exec(String(log?.detail ?? ""))?.[1] ?? "-1",
  );
  if (
    !log ||
    log.connectionId !== conn.id ||
    log.status !== "ok" ||
    log.operation !== "payment.start" ||
    cents !== amountCents
  )
    throw new UserError("@POS:PaymentFailed", { reason: "ref" });
  if ((await data.find("pos.receipt", { paymentRef: ref }, { take: 1 })).length)
    throw new UserError("@POS:PaymentFailed", { reason: "ref" });
}

export async function paymentCancel(
  data: DataApi,
  conn: RecordData,
  ref: string,
) {
  const log = await data.get("int.log", ref);
  if (!log || log.status !== "pending") return;
  if (conn.driver === "sumup")
    await sumup(
      conn,
      "POST",
      `/readers/${encodeURIComponent(String(conn.readerId))}/terminate`,
    );
  await data.update("int.log", ref, {
    status: "error",
    message: "Zrušeno pokladní",
  });
}

// ---------------------------------------------------------------------------
// Události napojení: kontrola nastavení, certifikát, test, párování
// ---------------------------------------------------------------------------

export const intHandlers: Record<string, ObjectHandlers> = {
  "int.document": {
    actions: {
      async check(ctx, doc) {
        if (doc.status === "listed") throw new UserError("@SYS:Locked");
        await checkDocument(ctx.data, doc, ctx.t);
      },
      async createPartner(ctx, doc) {
        await createDocPartner(ctx.data, doc, ctx.t);
      },
      async reject(ctx, doc) {
        await ctx.data.update("int.document", String(doc.id), { status: "rejected" });
      },
    },
  },
  "int.connection": {
    beforeSave(_ctx, d) {
      const e: Record<string, string> = {};
      // druh s jediným ovladačem (EET, API) ho dostane sám
      const allowed = DRIVERS[String(d.kind)] ?? [];
      if (!allowed.includes(String(d.driver)) && allowed.length === 1)
        d.driver = allowed[0];
      if (!allowed.includes(String(d.driver))) e.driver = "@INT:WrongDriver";
      if (d.kind === "eet" && d.driver === "eetSimulator") {
        d.unitId ??= "1";
        d.posId ??= "TEST";
      }
      if (d.kind === "eet" && !d.unitId) e.unitId = "@SYS:Required";
      if (d.kind === "eet" && !d.posId) e.posId = "@SYS:Required";
      if (d.kind === "api") {
        const scopes = String(d.scopes ?? "")
          .split(/[,\s]+/)
          .filter(Boolean);
        if (!scopes.length) e.scopes = "@INT:ScopesRequired";
        // jen existující moduly a objekty; správa systému a integrace přes API nikdy
        const bad = scopes.find(
          (s) =>
            !(registry.modules.has(s) || registry.objects.has(s)) ||
            s === "sys" ||
            s === "int" ||
            s.startsWith("sys.") ||
            s.startsWith("int."),
        );
        if (bad) e.scopes = "@INT:ScopeUnknown";
      }
      if (Object.keys(e).length) return e;
    },
    downloads: {
      /** nový klíč API: v databázi jen otisk, uživatel ho dostane jednou jako soubor */
      async token(ctx, conn) {
        if (conn.kind !== "api") throw new UserError("@INT:ApiOnly");
        const { token, hash, prefix } = newToken(ctx.tenantId);
        await ctx.data.update("int.connection", String(conn.id), {
          tokenHash: hash,
          tokenPrefix: prefix,
        });
        await writeLog(ctx.data, conn, "api.token", "ok", { message: prefix });
        return {
          name: `shanon-api-${String(conn.code).toLowerCase()}.txt`,
          mime: "text/plain; charset=utf-8",
          data: `${ctx.t("@INT:TokenFileHeader")}\n\n${token}\n`,
        };
      },
    },
    actions: {
      async uploadCert(ctx: EventContext, conn, file) {
        const pass = revealSecret(conn.certPassword);
        if (!file || pass === null) throw new UserError("@INT:NoCertificate");
        let cert: EetCert;
        try {
          cert = openP12(file.data.toString("base64"), pass);
        } catch {
          throw new UserError("@INT:BadCertificate");
        }
        await ctx.data.update("int.connection", String(conn.id), {
          certData: file.data.toString("base64"),
          certSubject: cert.subject,
          certValidTo: cert.validTo.toISOString().slice(0, 10),
        });
        await writeLog(ctx.data, conn, "eet.certificate", "ok", {
          message: `${cert.subject}, platnost do ${cert.validTo.toISOString().slice(0, 10)}`,
        });
      },
      async pair(ctx, conn) {
        if (!conn.pairingCode) throw new UserError("@INT:SumupPairingCode");
        const r = await sumup(conn, "POST", "/readers", {
          pairing_code: String(conn.pairingCode),
          name: String(conn.name),
        });
        if (!r.ok) {
          await writeLog(ctx.data, conn, "payment.pair", "error", {
            message: `${r.status} ${clip(r.text, 200)}`,
          });
          throw new UserError("@POS:PaymentFailed", {
            reason: String(r.status),
          });
        }
        const id = String(
          (r.json as RecordData).id ??
            ((r.json as RecordData).data as RecordData | undefined)?.id ??
            "",
        );
        await ctx.data.update("int.connection", String(conn.id), {
          readerId: id,
          pairingCode: null,
          lastCheckAt: today(),
          lastResult: ctx.t("@INT:Paired"),
        });
        await writeLog(ctx.data, conn, "payment.pair", "ok", {
          externalId: id,
        });
      },
      async test(ctx, conn) {
        if (conn.kind === "service") {
          const today = new Date().toISOString().slice(0, 10);
          const call =
            conn.driver === "ares"
              ? () => aresByIco("00006947")
              : conn.driver === "vies"
                ? () => viesLookup("CZ", "00006947")
                : conn.driver === "dphreg"
                ? () => vatRegistryStatus(["00006947"])
                : conn.driver === "cnb"
                ? () => fetchCnb(today)
                : () => fetchEcb(today, "CZK");
          try {
            await call();
            await writeLog(ctx.data, conn, "service.test", "ok", {
              message: ctx.t("@INT:ServiceTestOk"),
            });
            return setCheck(ctx.data, conn, ctx.t("@INT:ServiceTestOk"));
          } catch (e) {
            const msg = (e as { label?: string }).label
              ? ctx.t(
                  (e as { label: string }).label,
                  (e as { params?: Record<string, string> }).params,
                )
              : String(e);
            await writeLog(ctx.data, conn, "service.test", "error", {
              message: msg,
            });
            await setCheck(ctx.data, conn, msg);
            throw e;
          }
        }
        if (conn.driver === "eetSimulator")
          return setCheck(ctx.data, conn, ctx.t("@INT:TestOk"));
        if (conn.kind === "ocr") {
          const model = await testOpenAi(conn).catch(async (e) => {
            await writeLog(ctx.data, conn, "ocr.test", "error", { message: ctx.t((e as UserError).label ?? "@INT:StatusError", (e as UserError).params) });
            throw e;
          });
          await writeLog(ctx.data, conn, "ocr.test", "ok", { message: model });
          return setCheck(ctx.data, conn, ctx.t("@INT:OcrTestOk", { model }));
        }
        if (conn.kind === "eet") {
          const cert = eetCertOf(conn);
          const eic = await eetDic(ctx.data, ctx.companyId, conn, cert);
          if (cert.validTo < new Date())
            throw new UserError("@INT:CertExpired", {
              date: cert.validTo.toISOString().slice(0, 10),
            });
          if (cert.subject && cert.subject !== eic)
            throw new UserError("@INT:CertDicMismatch", {
              cert: cert.subject,
              dic: eic,
            });
          // ověřovací režim: zpráva se zpracuje, ale tržba se neeviduje
          const msg = buildEetMessage(
            {
              eic,
              unitId: String(conn.unitId),
              posId: String(conn.posId),
              seq: "TEST",
              date: new Date(),
              amount: "1.00",
            },
            cert,
            { first: true, verify: true },
          );
          const r = await sendEet(
            (conn.environment as EetEnvironment) ?? "playground",
            msg.xml,
            10000,
          );
          const ok = r.status === "verified" || r.status === "ok";
          await writeLog(ctx.data, conn, "eet.test", ok ? "ok" : "error", {
            externalId: "txId" in r ? r.txId : null,
            message: eetMessageText(r),
          });
          await setCheck(
            ctx.data,
            conn,
            ok ? ctx.t("@INT:EetTestOk") : eetMessageText(r),
          );
          if (!ok)
            throw new UserError("@POS:PaymentFailed", {
              reason: eetMessageText(r),
            });
          return;
        }
        if (conn.kind === "printer")
          return setCheck(ctx.data, conn, ctx.t("@INT:PrinterTestInfo"));
        if (conn.driver === "manual")
          return setCheck(ctx.data, conn, ctx.t("@INT:ManualOk"));
        if (conn.driver === "simulator")
          return setCheck(ctx.data, conn, ctx.t("@INT:TestOk"));
        if (!conn.readerId) throw new UserError("@INT:SumupNoReader");
        const r = await sumup(
          conn,
          "GET",
          `/readers/${encodeURIComponent(String(conn.readerId))}/status`,
        );
        const msg = r.ok
          ? `${ctx.t("@INT:TestOk")} ${clip(r.text, 120)}`
          : `${r.status} ${clip(r.text, 120)}`;
        await writeLog(ctx.data, conn, "payment.test", r.ok ? "ok" : "error", {
          message: msg,
        });
        await setCheck(ctx.data, conn, msg);
        if (!r.ok)
          throw new UserError("@POS:PaymentFailed", {
            reason: String(r.status),
          });
      },
    },
  },
};

/** Dávka: dodatečné odeslání čekajících účtenek do EET (všechny pokladny firmy). */
export const intJobs: JobDef[] = [
  // vytěžení nových dokladů (síť → mimo transakci, src/server/doc-import.ts)
  { id: "int.processDocuments", label: "@INT:JobDocuments", outside: true, default: { recurrence: "minutes", every: 15 }, run: async () => undefined },
  {
    id: "int.eetResend",
    label: "@INT:JobEetResend",
    default: { recurrence: "minutes", every: 15 },
    async run(ctx) {
      let sent = 0;
      let pending = 0;
      let registers: RecordData[] = [];
      try {
        registers = await ctx.data.find("pos.register", {}, { take: 100 });
      } catch {
        registers = []; // pokladna není zapnutá
      }
      for (const r of registers) {
        const x = await eetResendPending(ctx.data, ctx.companyId, String(r.id));
        sent += x.sent;
        pending += x.pending;
      }
      return ctx.t("@INT:EetResent", {
        sent: String(sent),
        pending: String(pending),
      });
    },
  },
];
