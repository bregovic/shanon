/**
 * Zařízení a tisková stanice: počítač s programem Shanon Pokladna (Windows) se spáruje kódem
 * z osobního instalátoru a dostane vlastní klíč (v DB jen otisk). Tiskárny Windows, které stanice
 * najde, se samy zapíší do `int.devicePrinter` (papír, kopie); pravidla `int.printRule` (Správa tisku)
 * určují, který doklad jde na kterou tiskárnu. Tisk = úloha `int.printJob` ve frontě, stanice si ji
 * vyzvedne (src/server/station.ts, /api/station/...), stáhne PDF a vytiskne bez dialogu.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineObject } from "@/core/object";

const Str = (id: string, label: string, maxLength: number) => defineEdt({ id, kind: "string", label, maxLength, transform: "trim" });

export const PrintJobStatus = defineEnum({
  id: "IntPrintJobStatus",
  label: "@INT:PrintJobStatus",
  values: [
    { value: "queued", label: "@INT:PJQueued", color: "informative" },
    { value: "sent", label: "@INT:PJSent", color: "warning" },
    { value: "done", label: "@INT:PJDone", color: "success" },
    { value: "error", label: "@INT:PJError", color: "danger" },
    { value: "cancelled", label: "@INT:PJCancelled" },
  ],
});

/** stav tiskárny podle Windows (Win32_Printer), jak ho naposledy nahlásila stanice */
export const PrinterState = defineEnum({
  id: "IntPrinterState",
  label: "@INT:PrinterState",
  values: [
    { value: "ready", label: "@INT:PSReady", color: "success" },
    { value: "printing", label: "@INT:PSPrinting", color: "informative" },
    { value: "offline", label: "@INT:PSOffline", color: "danger" },
    { value: "noPaper", label: "@INT:PSNoPaper", color: "danger" },
    { value: "lowPaper", label: "@INT:PSLowPaper", color: "warning" },
    { value: "jammed", label: "@INT:PSJammed", color: "danger" },
    { value: "doorOpen", label: "@INT:PSDoorOpen", color: "danger" },
    { value: "toner", label: "@INT:PSToner", color: "warning" },
    { value: "error", label: "@INT:PSError", color: "danger" },
    { value: "unknown", label: "@INT:PSUnknown" },
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

/** doklad pravidla tisku: tisknutelné doklady + „Ostatní doklady“ (*) — hodnoty doplní registr */
export const PrintRuleDoc = defineEnum({ id: "IntPrintRuleDoc", label: "@PRT:DocType", values: [] });

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
    /** Shanon chce hned nové hlášení tiskáren (Diagnostika → Obnovit stav); stanice ho pošle a příznak smaže */
    helloWanted: { edt: Edts.NoYes, label: "@INT:DeviceHelloWanted", readOnly: true },
    /** kdo na počítači pracuje: tisk tohoto uživatele bez zástupce Shanon Pokladna jde na tento počítač (jediný) */
    userId: { edt: Edts.User, label: "@INT:DeviceUser", help: "@INT:DeviceUserHelp" },
    hostName: { edt: Str("DeviceHost", "@INT:DeviceHost", 120), readOnly: true },
    /** USB tiskárny bez tiskárny ve Windows (chybí ovladač) – názvy z posledního hlášení stanice, oddělené | */
    usbNoDriver: { edt: Str("DeviceUsbNoDriver", "@INT:DeviceUsbNoDriver", 500), readOnly: true },
    agentVersion: { edt: Str("DeviceVersion", "@INT:DeviceVersion", 40), readOnly: true },
    /** prohlížeč, ze kterého se naposledy otevřela diagnostika tohoto počítače (založí / aktualizuje záznam sama) */
    browserInfo: { edt: Str("DeviceBrowserInfo", "@INT:DeviceBrowserInfo", 200), readOnly: true },
    browserSeenAt: { edt: Edts.DateTime, label: "@INT:DeviceBrowserSeenAt", readOnly: true },
    /** sdílené tiskárny (\\server\tiskárna) k připojení stanicí – JSON seznam; výsledek posledního připojení */
    connectQueue: { edt: Str("DeviceConnectQueue", "@INT:DeviceConnectQueue", 2000), readOnly: true },
    connectResult: { edt: Str("DeviceConnectResult", "@INT:DeviceConnectResult", 500), readOnly: true },
    /** založeno z Nastavení („Nainstalovat na tento počítač“) — kód a název se při spárování vezmou z názvu počítače */
    autoName: { edt: Edts.NoYes, label: "@INT:DeviceAutoName", readOnly: true },
    // klíč stanice a jednorázový párovací kód — jen otisky
    tokenHash: { edt: Str("DeviceTokenHash", "@INT:DevicePaired", 64), readOnly: true },
    pairHash: { edt: Str("DevicePairHash", "@INT:DevicePaired", 64), readOnly: true },
    pairExpires: { edt: Edts.DateTime, label: "@INT:DevicePaired", readOnly: true },
  },
  titleField: "code",
  list: ["code", "name", "userId", "registerId", "active", "paired", "lastSeenAt", "hostName", "agentVersion"],
  // Diagnostika tohoto počítače přímo ze seznamu (bez instalace; nezná-li ho Shanon, nabídne Přidat tento počítač)
  listDialog: { kind: "stationDiag", label: "@SYS:StationDiag" },
  form: [
    { label: "@SYS:General", fields: ["code", "name", "userId", "registerId", "active"] },
    { label: "@INT:State", fields: ["paired", "lastSeenAt", "hostName", "agentVersion", "browserInfo", "browserSeenAt", "connectResult"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [
    { object: "int.devicePrinter", field: "deviceId", label: "@INT:DevicePrinters", inline: true },
    { object: "int.printJob", field: "deviceId", label: "@INT:PrintJobs", owned: false, deletable: true },
  ],
  actions: [
    { id: "installer", label: "@INT:DeviceInstaller", when: { field: "active", equals: true } },
    { id: "unpair", label: "@INT:DeviceUnpair", when: { field: "paired", equals: true } },
    // Diagnostika: stanice běží, tiskárny se stavem z Windows, kam se tiskne, Obnovit stav, zkušební stránka
    { id: "diagnose", label: "@INT:DeviceDiag", dialog: "stationDiag", group: "inquiry" },
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
    /** používat na tomto počítači: jen používané se nabízí v pravidlech tisku a u pokladny (ostatní = jen nalezené) */
    enabled: { edt: Edts.NoYes, label: "@INT:PrinterEnabled", help: "@INT:PrinterEnabledHelp", default: true },
    /** ovladač Windows (rozpoznání modelu pro katalog) */
    driverName: { edt: Str("StationDriver", "@INT:PrinterDriver", 200), readOnly: true },
    modelId: { edt: refEdt("int.printerModel", "@INT:PrinterModel"), optionalRef: true },
    paper: { edt: enumEdt(DevicePaper), mandatory: true, default: "a4" },
    copies: { edt: Edts.Int, label: "@INT:Copies", default: 1 },
    isDefault: { edt: Edts.NoYes, label: "@INT:PrinterDefault", readOnly: true },
    /** stanice ji při posledním hlášení na počítači našla */
    present: { edt: Edts.NoYes, label: "@INT:PrinterPresent", readOnly: true, default: true },
    /** stav podle Windows a počet úloh ve frontě Windows (stanice 1.1+) */
    state: { edt: enumEdt(PrinterState), readOnly: true },
    queued: { edt: Edts.Int, label: "@INT:PrinterQueued", readOnly: true },
    stateAt: { edt: Edts.DateTime, label: "@INT:PrinterStateAt", readOnly: true },
  },
  titleField: "label",
  list: ["label", "enabled", "printerName", "paper", "copies", "isDefault", "present", "state", "queued", "stateAt", "modelId"],
  // ve výběru tiskárny (Správa tisku, pokladna) jen používané tiskárny, které Windows právě hlásí
  lookupWhere: { present: true, enabled: true },
  form: [{ label: "@SYS:General", fields: ["deviceId", "label", "enabled", "printerName", "driverName", "modelId", "paper", "copies", "isDefault", "present"] }],
  unique: [["deviceId", "printerName"]],
  defaultSort: { field: "label", dir: "asc" },
  actions: [
    { id: "test", label: "@INT:PrinterTest" },
    // uložit model do katalogu firmy (nastavení se přenese na další počítače s touto tiskárnou)
    { id: "toCatalog", label: "@INT:PrinterToCatalog" },
  ],
});

/** k čemu model v katalogu slouží: tiskárna na účtenky / na doklady (A4) / jen nalezená */
export const PrinterUsage = defineEnum({
  id: "IntPrinterUsage",
  label: "@INT:PrinterUsage",
  values: [
    { value: "receipts", label: "@INT:PUReceipts" },
    { value: "documents", label: "@INT:PUDocuments" },
    { value: "none", label: "@INT:PUNone" },
  ],
});

/**
 * Firemní katalog tiskáren: model rozpoznaný podle názvu ovladače / tiskárny / USB zařízení, odkaz na oficiální
 * ovladač výrobce a nastavení, které dostane každá tiskárna toho modelu na dalších počítačích (papír, kopie,
 * používat, na co). Ovladače se nikam nenahrávají – jen odkaz výrobce.
 */
export const printerModel = defineObject({
  id: "int.printerModel",
  table: "int_printer_model",
  label: "@INT:PrinterModel",
  labelPlural: "@INT:PrinterModels",
  scope: "company",
  shareable: true,
  fields: {
    name: { edt: Edts.Name, mandatory: true },
    /** text, podle kterého se model pozná (část názvu ovladače nebo tiskárny, mezery a pomlčky se nepočítají) */
    match: { edt: Str("PrinterModelMatch", "@INT:PrinterModelMatch", 120), mandatory: true, help: "@INT:PrinterModelMatchHelp" },
    driverUrl: { edt: Str("PrinterDriverUrl", "@INT:PrinterDriverUrl", 500), help: "@INT:PrinterDriverUrlHelp" },
    /** sdílená tiskárna ve Windows (\\server\tiskárna): diagnostika ji nabídne a stanice připojí (ovladač dá server tiskárny) */
    connectPath: { edt: Str("PrinterConnectPath", "@INT:PrinterConnectPath", 260), help: "@INT:PrinterConnectPathHelp" },
    paper: { edt: enumEdt(DevicePaper), mandatory: true, default: "a4" },
    copies: { edt: Edts.Int, label: "@INT:Copies", default: 1 },
    usage: { edt: enumEdt(PrinterUsage), mandatory: true, default: "documents" },
    notes: { edt: Edts.Notes, label: "@SYS:Notes" },
  },
  titleField: "name",
  list: ["name", "match", "usage", "paper", "copies", "driverUrl", "connectPath"],
  form: [{ label: "@SYS:General", fields: ["name", "match", "usage", "paper", "copies", "driverUrl", "connectPath", "notes"] }],
  unique: [["match"]],
  defaultSort: { field: "name", dir: "asc" },
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
    docType: { edt: enumEdt(PrintRuleDoc), mandatory: true },
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
  // staré a zaseknuté úlohy jde smazat (i hromadně)
  userDelete: true,
  // čekající / odeslanou úlohu jde zrušit (i hromadně ze seznamu); stanice ji pak nevytiskne
  actions: [{ id: "cancel", label: "@INT:PJCancel", bulk: true }],
});
