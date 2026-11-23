/**
 * Zařízení a tisková stanice: počítač s programem Shanon Pokladna (Windows) se spáruje kódem
 * z osobního instalátoru a dostane vlastní klíč (v DB jen otisk). Tiskárny Windows, které stanice
 * najde, se samy zapíší do `int.devicePrinter` (papír, kopie); pravidla `int.printRule` (Správa tisku)
 * určují, který doklad jde na kterou tiskárnu. Tisk = úloha `int.printJob` ve frontě, stanice si ji
 * vyzvedne (src/server/station.ts, /api/station/...), stáhne PDF a vytiskne bez dialogu.
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

/** papír tiskárny stanice: běžná tiskárna (A4) nebo role / A6 pro účtenky */
export const DevicePaper = defineEnum({
  id: "IntDevicePaper",
  label: "@INT:PaperWidth",
  values: [
    { value: "a4", label: "@INT:PaperA4" },
    { value: "80", label: "@INT:Paper80" },
    { value: "58", label: "@INT:Paper58" },
    { value: "a6", label: "@INT:PaperA6" },
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
    /** pokladna u tohoto počítače */
    registerId: { edt: refEdt("pos.register", "@INT:Register"), optionalRef: true },
    active: { edt: Edts.NoYes, label: "@INT:Active", default: true },
    paired: { edt: Edts.NoYes, label: "@INT:DevicePaired", readOnly: true },
    lastSeenAt: { edt: Edts.DateTime, label: "@INT:DeviceLastSeen", readOnly: true },
    hostName: { edt: Str("DeviceHost", "@INT:DeviceHost", 120), readOnly: true },
    agentVersion: { edt: Str("DeviceVersion", "@INT:DeviceVersion", 40), readOnly: true },
    /** založeno z Nastavení („Nainstalovat na tento počítač“) — kód a název se při spárování vezmou z názvu počítače */
    autoName: { edt: Edts.NoYes, label: "@INT:DeviceAutoName", readOnly: true },
    // klíč stanice a jednorázový párovací kód — jen otisky
    tokenHash: { edt: Str("DeviceTokenHash", "@INT:DevicePaired", 64), readOnly: true },
    pairHash: { edt: Str("DevicePairHash", "@INT:DevicePaired", 64), readOnly: true },
    pairExpires: { edt: Edts.DateTime, label: "@INT:DevicePaired", readOnly: true },
  },
  titleField: "code",
  list: ["code", "name", "registerId", "active", "paired", "lastSeenAt", "hostName", "agentVersion"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "registerId", "active"] },
    { label: "@INT:State", fields: ["paired", "lastSeenAt", "hostName", "agentVersion"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [
    { object: "int.devicePrinter", field: "deviceId", label: "@INT:DevicePrinters", inline: true },
    { object: "int.printJob", field: "deviceId", label: "@INT:PrintJobs", owned: false },
  ],
  actions: [
    { id: "installer", label: "@INT:DeviceInstaller", download: true, downloadNeedsWrite: true },
    { id: "unpair", label: "@INT:DeviceUnpair", when: { field: "paired", equals: true } },
  ],
});

/** Tiskárna Windows na zařízení — zapisuje ji stanice sama (podle toho, co na počítači najde). */
export const devicePrinter = defineObject({
  id: "int.devicePrinter",
  table: "int_device_printer",
  label: "@INT:DevicePrinter",
  labelPlural: "@INT:DevicePrinters",
  scope: "company",
  fields: {
    deviceId: { edt: refEdt("int.device", "@INT:Device"), mandatory: true },
    /** zobrazovaný název „KASA1 · XP-58“ (lze přejmenovat, např. „Účtenky u pultu“) */
    label: { edt: Edts.Name, label: "@INT:Printer", mandatory: true },
    printerName: { edt: Str("StationPrinter", "@INT:PrinterName", 200), mandatory: true },
    paper: { edt: enumEdt(DevicePaper), mandatory: true, default: "a4" },
    copies: { edt: Edts.Int, label: "@INT:Copies", default: 1 },
    isDefault: { edt: Edts.NoYes, label: "@INT:PrinterDefault", readOnly: true },
    /** stanice ji při posledním hlášení na počítači našla */
    present: { edt: Edts.NoYes, label: "@INT:PrinterPresent", readOnly: true, default: true },
  },
  titleField: "label",
  list: ["label", "printerName", "paper", "copies", "isDefault", "present"],
  form: [{ label: "@SYS:General", fields: ["deviceId", "label", "printerName", "paper", "copies", "isDefault", "present"] }],
  unique: [["deviceId", "printerName"]],
  defaultSort: { field: "label", dir: "asc" },
  actions: [{ id: "test", label: "@INT:PrinterTest" }],
});

/**
 * Správa tisku: který doklad se tiskne na kterou tiskárnu. Platí nejpřesnější pravidlo — pro uživatele,
 * pak pro počítač, ze kterého se tiskne, pak pro pokladnu; pravidlo bez omezení platí pro všechny.
 */
export const printRule = defineObject({
  id: "int.printRule",
  table: "int_print_rule",
  label: "@INT:PrintRule",
  labelPlural: "@INT:PrintRules",
  scope: "company",
  fields: {
    docType: { edt: enumEdt(PrintDocType), mandatory: true },
    printerId: { edt: refEdt("int.devicePrinter", "@INT:Printer"), mandatory: true },
    /** jen když se tiskne z tohoto počítače (zástupce Shanon Pokladna) */
    fromDeviceId: { edt: refEdt("int.device", "@INT:PrintRuleFrom"), optionalRef: true },
    /** jen účtenky této pokladny */
    registerId: { edt: refEdt("pos.register", "@INT:Register"), optionalRef: true, visibleWhen: { field: "docType", in: ["pos.receipt"] } },
    userId: { edt: Edts.User, label: "@INT:PrintRouteUser" },
    /** účtenka: vytisknout hned po zaplacení (bez tlačítka Tisk) */
    autoPrint: { edt: Edts.NoYes, label: "@INT:AutoPrint", visibleWhen: { field: "docType", in: ["pos.receipt"] } },
    active: { edt: Edts.NoYes, label: "@INT:Active", default: true },
  },
  titleField: "docType",
  list: ["docType", "printerId", "fromDeviceId", "registerId", "userId", "autoPrint", "active"],
  form: [{ label: "@SYS:General", fields: ["docType", "printerId", "fromDeviceId", "registerId", "userId", "autoPrint", "active"] }],
  defaultSort: { field: "docType", dir: "asc" },
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
    printerId: { edt: refEdt("int.devicePrinter", "@INT:Printer"), mandatory: true },
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
  list: ["reference", "printerId", "deviceId", "status", "copies", "sentAt", "doneAt", "message"],
  form: [{ label: "@SYS:General", fields: ["reference", "deviceId", "printerId", "copies", "status", "sentAt", "doneAt", "message"] }],
  indexes: [["deviceId", "status"]],
  defaultSort: { field: "createdAt", dir: "desc" },
});
