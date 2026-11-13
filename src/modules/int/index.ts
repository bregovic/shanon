/**
 * Integrace: napojení firmy na vnější služby a zařízení — evidence tržeb
 * (EET 2.0), tiskárny účtenek, platební terminály; později e-shopy a API.
 *
 * Napojení = druh + ovladač (src/modules/int/drivers) + nastavení. Tajné
 * údaje (certifikát, hesla, API klíče) jsou pole se `secret` — v databázi
 * šifrovaně, uživateli se nevrací. Každá komunikace se zapíše do protokolu.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule } from "@/core/module";
import { defineObject } from "@/core/object";

export const ConnKind = defineEnum({
  id: "IntConnKind",
  label: "@INT:Kind",
  values: [
    { value: "eet", label: "@INT:KindEet" },
    { value: "printer", label: "@INT:KindPrinter" },
    { value: "payment", label: "@INT:KindPayment" },
  ],
});

/** Ovladače; který patří ke kterému druhu, hlídá drivers.ts. */
export const Driver = defineEnum({
  id: "IntDriver",
  label: "@INT:Driver",
  values: [
    { value: "eet2", label: "@INT:DrvEet2" },
    { value: "browser", label: "@INT:DrvBrowser" },
    { value: "escposSerial", label: "@INT:DrvEscposSerial" },
    { value: "manual", label: "@INT:DrvManual" },
    { value: "sumup", label: "@INT:DrvSumup" },
    { value: "simulator", label: "@INT:DrvSimulator" },
  ],
});

export const EetEnv = defineEnum({
  id: "IntEetEnv",
  label: "@INT:Environment",
  values: [
    { value: "playground", label: "@INT:EnvPlayground" },
    { value: "production", label: "@INT:EnvProduction" },
  ],
});

export const PaperWidth = defineEnum({
  id: "IntPaperWidth",
  label: "@INT:PaperWidth",
  values: [
    { value: "80", label: "@INT:Paper80" },
    { value: "58", label: "@INT:Paper58" },
  ],
});

export const CodePage = defineEnum({
  id: "IntCodePage",
  label: "@INT:CodePage",
  values: [
    { value: "cp852", label: "@INT:Cp852" },
    { value: "ascii", label: "@INT:Ascii" },
  ],
});

export const LogStatus = defineEnum({
  id: "IntLogStatus",
  label: "@GL:Status",
  values: [
    { value: "ok", label: "@INT:StatusOk" },
    { value: "pending", label: "@INT:StatusPending" },
    { value: "error", label: "@INT:StatusError" },
  ],
});

const Str = (id: string, label: string, maxLength: number, pattern?: RegExp, patternMessage?: string) =>
  defineEdt({ id, kind: "string", label, maxLength, pattern, patternMessage, transform: "trim" });
const Secret = (id: string, label: string, kind: "string" | "text" = "string") =>
  defineEdt({ id, kind, label, maxLength: kind === "string" ? 4000 : undefined });

const EET = { field: "kind", in: ["eet"] };
const PRINTER = { field: "kind", in: ["printer"] };
const SUMUP = { field: "driver", in: ["sumup"] };
const SERIAL = { field: "driver", in: ["escposSerial"] };

export const connection = defineObject({
  id: "int.connection",
  table: "int_connection",
  label: "@INT:Connection",
  labelPlural: "@INT:Connections",
  scope: "company",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    kind: { edt: enumEdt(ConnKind), mandatory: true, default: "eet" },
    driver: { edt: enumEdt(Driver), mandatory: true, default: "eet2" },
    /** pokladna, pro kterou napojení platí (prázdné = všechny pokladny firmy) */
    registerId: { edt: refEdt("pos.register", "@INT:Register"), optionalRef: true },
    active: { edt: Edts.NoYes, label: "@INT:Active", default: true },
    // EET 2.0
    environment: { edt: enumEdt(EetEnv), default: "playground", visibleWhen: EET },
    unitId: { edt: Str("EetUnitId", "@INT:UnitId", 9, /^[1-9]\d{0,8}$/, "@INT:UnitIdHelp"), visibleWhen: EET },
    posId: { edt: Str("EetPosId", "@INT:PosId", 20, /^[0-9a-zA-Z.,:;/#\-_ ]{1,20}$/, "@INT:PosIdHelp"), visibleWhen: EET },
    certPassword: { edt: Secret("CertPassword", "@INT:CertPassword"), secret: true, visibleWhen: EET },
    certData: { edt: Secret("CertData", "@INT:Certificate", "text"), secret: true, readOnly: true },
    certSubject: { edt: Edts.Description, label: "@INT:CertSubject", readOnly: true, visibleWhen: EET },
    certValidTo: { edt: Edts.TransDate, label: "@INT:CertValidTo", readOnly: true, visibleWhen: EET },
    // tiskárna
    paperWidth: { edt: enumEdt(PaperWidth), default: "80", visibleWhen: PRINTER },
    codePage: { edt: enumEdt(CodePage), default: "cp852", visibleWhen: SERIAL },
    baudRate: { edt: Edts.Int, label: "@INT:BaudRate", default: 9600, visibleWhen: SERIAL },
    openDrawer: { edt: Edts.NoYes, label: "@INT:OpenDrawer", visibleWhen: SERIAL },
    autoPrint: { edt: Edts.NoYes, label: "@INT:AutoPrint", visibleWhen: PRINTER },
    // platební terminál SumUp (Cloud API, čtečka Solo)
    merchantCode: { edt: Str("SumupMerchant", "@INT:MerchantCode", 20), visibleWhen: SUMUP },
    apiKey: { edt: Secret("SumupApiKey", "@INT:ApiKey"), secret: true, visibleWhen: SUMUP },
    affiliateAppId: { edt: Str("SumupAppId", "@INT:AffiliateAppId", 120), visibleWhen: SUMUP },
    affiliateKey: { edt: Secret("SumupAffKey", "@INT:AffiliateKey"), secret: true, visibleWhen: SUMUP },
    pairingCode: { edt: Str("SumupPairing", "@INT:PairingCode", 20), visibleWhen: SUMUP },
    readerId: { edt: Str("SumupReader", "@INT:ReaderId", 60), readOnly: true, visibleWhen: SUMUP },
    // stav
    lastCheckAt: { edt: Edts.TransDate, label: "@INT:LastCheck", readOnly: true },
    lastResult: { edt: Edts.Description, label: "@INT:LastResult", readOnly: true },
  },
  titleField: "code",
  list: ["code", "name", "kind", "driver", "registerId", "active", "lastCheckAt", "lastResult"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "kind", "driver", "registerId", "active"] },
    { label: "@INT:EetSettings", fields: ["environment", "unitId", "posId", "certPassword", "certSubject", "certValidTo"], visibleWhen: EET },
    { label: "@INT:PrinterSettings", fields: ["paperWidth", "codePage", "baudRate", "openDrawer", "autoPrint"], visibleWhen: PRINTER },
    { label: "@INT:PaymentSettings", fields: ["merchantCode", "apiKey", "affiliateAppId", "affiliateKey", "pairingCode", "readerId"], visibleWhen: SUMUP },
    { label: "@INT:State", fields: ["lastCheckAt", "lastResult"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [{ object: "int.log", field: "connectionId", label: "@INT:Log", owned: false }],
  actions: [
    { id: "uploadCert", label: "@INT:UploadCert", upload: ".p12,.pfx", when: { field: "kind", equals: "eet" } },
    { id: "pair", label: "@INT:Pair", when: { field: "driver", equals: "sumup" } },
    { id: "test", label: "@INT:Test" },
  ],
});

export const log = defineObject({
  id: "int.log",
  table: "int_log",
  label: "@INT:LogEntry",
  labelPlural: "@INT:Log",
  scope: "company",
  systemOnly: true,
  fields: {
    connectionId: { edt: refEdt("int.connection", "@INT:Connection"), mandatory: true },
    operation: { edt: Str("IntOperation", "@INT:Operation", 40), mandatory: true },
    status: { edt: enumEdt(LogStatus), mandatory: true },
    reference: { edt: Edts.Description, label: "@INT:Reference" },
    externalId: { edt: Edts.Description, label: "@INT:ExternalId" },
    message: { edt: Edts.Description, label: "@INT:Message" },
    detail: { edt: Edts.Notes, label: "@INT:Detail" },
  },
  titleField: "operation",
  list: ["operation", "status", "reference", "externalId", "message"],
  form: [
    { label: "@SYS:General", fields: ["connectionId", "operation", "status", "reference", "externalId", "message"] },
    { label: "@INT:Detail", fields: ["detail"] },
  ],
});

export default defineModule({
  id: "int",
  label: "@INT:Module",
  description: "@INT:ModuleDesc",
  icon: "PlugConnected",
  dependsOn: ["sys"],
  enums: [ConnKind, Driver, EetEnv, PaperWidth, CodePage, LogStatus],
  objects: [connection, log],
  menu: [
    { label: "@INT:Module", items: [{ object: "int.connection" }, { object: "int.log" }] },
  ],
  labels: {
    cs: {
      Module: "Integrace",
      ModuleDesc: "Napojení na evidenci tržeb (EET 2.0), tiskárny účtenek, platební terminály a další služby.",
      Connection: "Napojení",
      Connections: "Napojení",
      Kind: "Druh",
      KindEet: "Evidence tržeb (EET 2.0)",
      KindPrinter: "Tiskárna účtenek",
      KindPayment: "Platební terminál",
      Driver: "Ovladač",
      DrvEet2: "EET 2.0 – Finanční správa",
      DrvBrowser: "Tisk z prohlížeče",
      DrvEscposSerial: "ESC/POS přes USB/sériový port",
      DrvManual: "Ruční potvrzení na terminálu",
      DrvSumup: "SumUp Solo (Cloud API)",
      DrvSimulator: "Simulátor (zkoušení)",
      Register: "Pokladna",
      Active: "Aktivní",
      Environment: "Prostředí",
      EnvPlayground: "Testovací (Playground)",
      EnvProduction: "Ostré",
      UnitId: "Evidenční jednotka (ID)",
      UnitIdHelp: "Číslo evidenční jednotky z portálu MOJE daně (1–9 číslic).",
      PosId: "Označení pokladního zařízení",
      PosIdHelp: "Až 20 znaků: písmena bez diakritiky, číslice a . , : ; / # - _",
      CertPassword: "Heslo k certifikátu",
      Certificate: "Pokladní certifikát",
      CertSubject: "Certifikát (DIČ)",
      CertValidTo: "Platnost certifikátu do",
      EetSettings: "Evidence tržeb",
      PrinterSettings: "Tiskárna",
      PaymentSettings: "Platební terminál",
      State: "Stav",
      PaperWidth: "Šířka papíru",
      Paper80: "80 mm",
      Paper58: "58 mm",
      CodePage: "Kódová stránka",
      Cp852: "PC852 (čeština)",
      Ascii: "Bez diakritiky",
      BaudRate: "Rychlost portu (baud)",
      OpenDrawer: "Otevírat pokladní zásuvku",
      AutoPrint: "Tisknout účtenku automaticky",
      MerchantCode: "Kód obchodníka (merchant code)",
      ApiKey: "API klíč",
      AffiliateAppId: "Affiliate App ID",
      AffiliateKey: "Affiliate klíč",
      PairingCode: "Párovací kód ze čtečky",
      ReaderId: "ID čtečky",
      LastCheck: "Poslední kontrola",
      LastResult: "Výsledek",
      UploadCert: "Nahrát certifikát",
      Pair: "Spárovat čtečku",
      Test: "Otestovat spojení",
      Log: "Protokol komunikace",
      LogEntry: "Záznam protokolu",
      Operation: "Operace",
      StatusOk: "V pořádku",
      StatusPending: "Čeká",
      StatusError: "Chyba",
      Reference: "Doklad",
      ExternalId: "Kód / ID",
      Message: "Zpráva",
      Detail: "Podrobnosti",
      WrongDriver: "Ovladač nepatří k druhu napojení.",
      NeedUnitPos: "Vyplňte evidenční jednotku a označení pokladního zařízení.",
      NoCertificate: "Nahrajte pokladní certifikát (.p12) a vyplňte heslo.",
      BadCertificate: "Certifikát nejde otevřít — zkontrolujte soubor a heslo.",
      CertExpired: "Platnost certifikátu skončila {date}.",
      CertDicMismatch: "Certifikát patří {cert}, firma má DIČ {dic}.",
      NoCompanyDic: "Firma nemá DIČ — EET ho potřebuje.",
      SumupMissing: "Vyplňte kód obchodníka a API klíč.",
      SumupNoReader: "Nejdřív spárujte čtečku (párovací kód ze čtečky Solo).",
      SumupPairingCode: "Vyplňte párovací kód ze čtečky (platí 5 minut).",
      TestOk: "Spojení funguje.",
      EetTestOk: "EET: ověřovací zpráva přijata.",
      PrinterTestInfo: "Tiskárnu otestujte v terminálu pokladny tlačítkem Tisk.",
      ManualOk: "Ruční potvrzení nepotřebuje spojení.",
      Paired: "Čtečka spárována.",
      NoConnection: "Napojení nenalezeno nebo není aktivní.",
    },
    en: {
      Module: "Integrations",
      ModuleDesc: "Connections to sales registration (EET 2.0), receipt printers, payment terminals and other services.",
      Connection: "Connection",
      Connections: "Connections",
      Kind: "Type",
      KindEet: "Sales registration (EET 2.0)",
      KindPrinter: "Receipt printer",
      KindPayment: "Payment terminal",
      Driver: "Driver",
      DrvEet2: "EET 2.0 – Financial Administration",
      DrvBrowser: "Browser printing",
      DrvEscposSerial: "ESC/POS over USB/serial port",
      DrvManual: "Manual confirmation on terminal",
      DrvSumup: "SumUp Solo (Cloud API)",
      DrvSimulator: "Simulator (testing)",
      Register: "Register",
      Active: "Active",
      Environment: "Environment",
      EnvPlayground: "Test (Playground)",
      EnvProduction: "Production",
      UnitId: "Registration unit (ID)",
      UnitIdHelp: "Registration unit number from the MOJE daně portal (1–9 digits).",
      PosId: "Register device ID",
      PosIdHelp: "Up to 20 characters: letters without accents, digits and . , : ; / # - _",
      CertPassword: "Certificate password",
      Certificate: "Register certificate",
      CertSubject: "Certificate (VAT ID)",
      CertValidTo: "Certificate valid until",
      EetSettings: "Sales registration",
      PrinterSettings: "Printer",
      PaymentSettings: "Payment terminal",
      State: "State",
      PaperWidth: "Paper width",
      Paper80: "80 mm",
      Paper58: "58 mm",
      CodePage: "Code page",
      Cp852: "PC852 (Czech)",
      Ascii: "Without accents",
      BaudRate: "Port speed (baud)",
      OpenDrawer: "Open cash drawer",
      AutoPrint: "Print receipt automatically",
      MerchantCode: "Merchant code",
      ApiKey: "API key",
      AffiliateAppId: "Affiliate App ID",
      AffiliateKey: "Affiliate key",
      PairingCode: "Pairing code from the reader",
      ReaderId: "Reader ID",
      LastCheck: "Last check",
      LastResult: "Result",
      UploadCert: "Upload certificate",
      Pair: "Pair reader",
      Test: "Test connection",
      Log: "Communication log",
      LogEntry: "Log entry",
      Operation: "Operation",
      StatusOk: "OK",
      StatusPending: "Pending",
      StatusError: "Error",
      Reference: "Document",
      ExternalId: "Code / ID",
      Message: "Message",
      Detail: "Detail",
      WrongDriver: "The driver does not match the connection type.",
      NeedUnitPos: "Fill in the registration unit and register device ID.",
      NoCertificate: "Upload the register certificate (.p12) and fill in its password.",
      BadCertificate: "The certificate cannot be opened — check the file and password.",
      CertExpired: "The certificate expired on {date}.",
      CertDicMismatch: "The certificate belongs to {cert}, the company VAT ID is {dic}.",
      NoCompanyDic: "The company has no VAT ID — EET requires it.",
      SumupMissing: "Fill in the merchant code and API key.",
      SumupNoReader: "Pair the reader first (pairing code from the Solo reader).",
      SumupPairingCode: "Fill in the pairing code from the reader (valid 5 minutes).",
      TestOk: "Connection works.",
      EetTestOk: "EET: verification message accepted.",
      PrinterTestInfo: "Test the printer in the register terminal with the Print button.",
      ManualOk: "Manual confirmation needs no connection.",
      Paired: "Reader paired.",
      NoConnection: "Connection not found or not active.",
    },
  },
});
