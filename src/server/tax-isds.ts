/**
 * Podání přiznání k DPH / kontrolního hlášení datovou schránkou (tax.return → Odeslat datovou schránkou).
 * Mimo transakci (síť): XML z exportu EPO → datová zpráva do schránky finančního úřadu (Daňové parametry) přes napojení
 * druhu Datová schránka; po přijetí zprávy je podání Podané s číslem zprávy, vše v protokolu napojení (int.log).
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import { writeLog } from "@/modules/int/drivers";
import { isdsOwnBox, isdsSend } from "@/modules/int/isds";
import { fillLabel, resolveLabel } from "@/core/labels";
import { labelTable } from "@/registry";
import { downloadFile, inTenant, type Ctx } from "./data";

/**
 * Kontroly před podáním (i samostatně jako Zkontrolovat odeslání): adresát vyplněný a není to schránka firmy,
 * napojení se přihlásí do schránky firmy (ID z Daňových parametrů), XML podání jde sestavit. Vrací souhrn.
 */
async function preflight(ctx: Ctx, id: string, client?: PrismaClient) {
  const prep = await prepare(ctx, id, client);
  const recipient = prep.recipient.trim().toLowerCase();
  const own = String(prep.ownBox ?? "").trim().toLowerCase();
  if (!recipient) throw new UserError("@TAX:IsdsNoRecipient");
  if (own && recipient === own) throw new UserError("@TAX:IsdsToSelf");
  // přihlášení do schránky: ze které schránky by podání odešlo
  const from = (await isdsOwnBox(prep.conn)).trim().toLowerCase();
  if (own && from && from !== own) throw new UserError("@TAX:IsdsWrongSender", { own: from, expected: own });
  const file = await downloadFile(ctx, "tax.return", id, "xml", client);
  return { ...prep, from, file };
}

/** Zkontrolovat odeslání (nic neodešle): souhrn odkud kam a co by se poslalo. */
export async function checkReturnIsds(ctx: Ctx, id: string, client?: PrismaClient) {
  const p = await preflight(ctx, id, client);
  const lang = ctx.lang ?? "cs";
  const t = (ref: string, params?: Record<string, string>) => fillLabel(resolveLabel(labelTable, ref, lang), params);
  const test = String(p.conn.code).startsWith("TEST-") || p.conn.driver === "isdsTest";
  return {
    message: t("@TAX:IsdsCheckOk", { env: t(test ? "@TAX:IsdsEnvTest" : "@TAX:IsdsEnvLive"), from: p.from || "?", conn: String(p.conn.code), to: p.recipient, file: p.file.name }),
  };
}

async function prepare(ctx: Ctx, id: string, client?: PrismaClient) {
  return inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      const ret = await api.get("tax.return", id);
      if (!ret) throw new UserError("@SYS:NotFound");
      if (ret.status !== "draft") throw new UserError("@SYS:Locked");
      if (!ret.computedAt) throw new UserError("@TAX:NotComputed");
      const [params] = await api.find("tax.parameters", {}, { take: 1 });
      // napojení: testovací (TEST-…) má přednost, jinak ostré
      const conns = (await api.find("int.connection", { kind: "isds", active: true }, { take: 20 })).sort((a, b) => Number(String(b.code).startsWith("TEST-")) - Number(String(a.code).startsWith("TEST-")));
      if (!conns[0]) throw new UserError("@INT:IsdsNoConnection");
      return { ret, recipient: String(params?.taxOfficeDataBox ?? ""), ownBox: (params?.dataBoxId as string) ?? null, conn: conns[0] as RecordData };
    },
    client,
  );
}

export async function sendReturnIsds(ctx: Ctx, id: string, client?: PrismaClient): Promise<void> {
  // stejné kontroly jako Zkontrolovat odeslání — z cizí schránky ani sám sobě se nepodává
  const prep = await preflight(ctx, id, client);
  const file = prep.file;
  const xml = typeof file.data === "string" ? file.data : file.data.toString("utf8");
  let messageId: string;
  try {
    messageId = await isdsSend(prep.conn, { recipient: prep.recipient, annotation: file.name.replace(/\.xml$/, ""), fileName: file.name, xml });
  } catch (e) {
    await inTenant(ctx, (s) => writeLog(s.sys().api(), prep.conn, "isds.send", "error", { reference: String(prep.ret.period ?? ""), message: e instanceof UserError ? e.label : String(e) }), client).catch(() => undefined);
    throw e;
  }
  await inTenant(
    ctx,
    async (s) => {
      const api = s.sys().api();
      await api.update("tax.return", id, { status: "filed", isdsMessageId: messageId, sentAt: new Date().toISOString().slice(0, 10) });
      await writeLog(api, prep.conn, "isds.send", "ok", { reference: String(prep.ret.period ?? ""), externalId: messageId, message: file.name });
      api.warn?.("@TAX:IsdsSent", { id: messageId });
    },
    client,
  );
}
