/**
 * Zařízení a tisková stanice: počítač s programem Shanon Pokladna (Windows) se spáruje kódem
 * z osobního instalátoru a dostane vlastní klíč (v DB jen otisk). Tiskárny stanice jsou napojení
 * druhu tiskárna s ovladačem `station` (zařízení + tiskárna Windows + papír + kopie), pravidla
 * `int.printRoute` určují, které doklady na ně jdou. Tisk = úloha `int.printJob` ve frontě, stanice
 * si ji vyzvedne (src/server/station.ts, /api/station/...), stáhne PDF a vytiskne bez dialogu.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineObject } from "@/core/object";
import { PrintDocType } from "@/modules/prt";

const Str = (id: string, label: string, maxLength: number) => defineEdt({ id, kind: "string", label, maxLength, transform: "trim" });

export const PrintJobStatus = defineEnum({
  id: "IntPrintJobStatus",
  label: "@INT:PrintJobStatus",
  values: [
    { value: "queued", label: "@INT:PJQueued", color: "informative" },
    { value: "sent", label: "@INT:PJSent", color: "warning" },
    { value: "done", label: "@INT:PJDone", color: "success" },
    { value: "error", label: "@INT:PJError", color: "danger" },
  ],
});

export const device = defineObject({
  id: "int.device",
  table: "int_device",
  label: "@INT:Device",
  labelPlural: "@INT:Devices",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    /** pokladna u tohoto počítače (účtenky bez vlastní tiskárny pokladny jdou na tiskárnu stanice) */
    registerId: { edt: refEdt("pos.register", "@INT:Register"), optionalRef: true },
    active: { edt: Edts.NoYes, label: "@INT:Active", default: true },
    paired: { edt: Edts.NoYes, label: "@INT:DevicePaired", readOnly: true },
    lastSeenAt: { edt: Edts.DateTime, label: "@INT:DeviceLastSeen", readOnly: true },
    hostName: { edt: Str("DeviceHost", "@INT:DeviceHost", 120), readOnly: true },
    agentVersion: { edt: Str("DeviceVersion", "@INT:DeviceVersion", 40), readOnly: true },
    /** tiskárny Windows, které stanice nahlásila (název na řádek, výchozí s hvězdičkou) */
    printers: { edt: Edts.Notes, label: "@INT:DevicePrinters", readOnly: true },
    // klíč stanice a jednorázový párovací kód — jen otisky
    tokenHash: { edt: Str("DeviceTokenHash", "@INT:DevicePaired", 64), readOnly: true },
    pairHash: { edt: Str("DevicePairHash", "@INT:DevicePaired", 64), readOnly: true },
    pairExpires: { edt: Edts.DateTime, label: "@INT:DevicePaired", readOnly: true },
  },
  titleField: "code",
  list: ["code", "name", "registerId", "active", "paired", "lastSeenAt", "hostName", "agentVersion"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "registerId", "active"] },
    { label: "@INT:State", fields: ["paired", "lastSeenAt", "hostName", "agentVersion", "printers"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [
    { object: "int.connection", field: "deviceId", label: "@INT:DevicePrinterConns", owned: false },
    { object: "int.printJob", field: "deviceId", label: "@INT:PrintJobs", owned: false },
  ],
  actions: [
    { id: "installer", label: "@INT:DeviceInstaller", download: true, downloadNeedsWrite: true },
    { id: "unpair", label: "@INT:DeviceUnpair", when: { field: "paired", equals: true } },
  ],
});

/** Které doklady se tisknou na tiskárnu stanice (řádky napojení tiskárny). */
export const printRoute = defineObject({
  id: "int.printRoute",
  table: "int_print_route",
  label: "@INT:PrintRoute",
  labelPlural: "@INT:PrintRoutes",
  scope: "company",
  fields: {
    connectionId: { edt: refEdt("int.connection", "@INT:Connection"), mandatory: true },
    docType: { edt: enumEdt(PrintDocType), mandatory: true },
    /** jen pro tohoto uživatele (prázdné = všichni) */
    userId: { edt: Edts.User, label: "@INT:PrintRouteUser" },
  },
  titleField: "docType",
  list: ["docType", "userId"],
  form: [{ label: "@SYS:General", fields: ["connectionId", "docType", "userId"] }],
  unique: [["connectionId", "docType", "userId"]],
});

/** Tisková úloha ve frontě stanice. */
export const printJob = defineObject({
  id: "int.printJob",
  table: "int_print_job",
  label: "@INT:PrintJob",
  labelPlural: "@INT:PrintJobs",
  scope: "company",
  systemOnly: true,
  fields: {
    deviceId: { edt: refEdt("int.device", "@INT:Device"), mandatory: true },
    connectionId: { edt: refEdt("int.connection", "@INT:Printer"), mandatory: true },
    /** druh dokladu (prázdné = zkušební stránka) */
    docType: { edt: Str("PrintJobDocType", "@INT:PrintJobDoc", 40) },
    recordId: { edt: Str("PrintJobRecord", "@INT:PrintJobDoc", 36) },
    /** šablona zvolená v náhledu (prázdné = podle papíru tiskárny / výchozí) */
    templateId: { edt: Str("PrintJobTemplate", "@INT:PrintJobDoc", 36) },
    reference: { edt: Edts.Description, label: "@INT:Reference" },
    copies: { edt: Edts.Int, label: "@INT:Copies", default: 1 },
    status: { edt: enumEdt(PrintJobStatus), mandatory: true, default: "queued" },
    message: { edt: Edts.Description, label: "@INT:Message" },
    sentAt: { edt: Edts.DateTime, label: "@INT:PJSentAt" },
    doneAt: { edt: Edts.DateTime, label: "@INT:PJDoneAt" },
  },
  titleField: "reference",
  list: ["reference", "connectionId", "deviceId", "status", "copies", "sentAt", "doneAt", "message"],
  form: [{ label: "@SYS:General", fields: ["reference", "deviceId", "connectionId", "copies", "status", "sentAt", "doneAt", "message"] }],
  indexes: [["deviceId", "status"]],
  defaultSort: { field: "createdAt", dir: "desc" },
});
