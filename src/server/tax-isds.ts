/**
 * Podání přiznání k DPH / kontrolního hlášení datovou schránkou (tax.return → Odeslat datovou schránkou).
 * Mimo transakci (síť): XML z exportu EPO → datová zpráva do schránky finančního úřadu (Daňové parametry) přes napojení
 * druhu Datová schránka; po přijetí zprávy je podání Podané s číslem zprávy, vše v protokolu napojení (int.log).
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { UserError, type RecordData } from "@/core/module";
import { writeLog } from "@/modules/int/drivers";
import { isdsSend } from "@/modules/int/isds";
import { downloadFile, inTenant, type Ctx } from "./data";

export async function sendReturnIsds(ctx: Ctx, id: string, client?: PrismaClient): Promise<void> {
  const prep = await inTenant(
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
      return { ret, recipient: String(params?.taxOfficeDataBox ?? ""), conn: conns[0] as RecordData };
    },
    client,
  );
  const file = await downloadFile(ctx, "tax.return", id, "xml", client);
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
