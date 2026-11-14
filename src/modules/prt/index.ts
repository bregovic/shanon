/**
 * Tiskové sestavy: šablony dokladů (faktura, účtenka…) per firma, návrhář
 * na plátně (/print/designer), tisk a PDF z dokladu (/print/<druh>/<id>).
 * Zapíná se sám s moduly, které tisknou (Pohledávky, Pokladna).
 */
import { Edts, defineEnum, enumEdt } from "@/core/edt";
import { defineModule, type DataApi, type ObjectHandlers } from "@/core/module";
import { defineObject } from "@/core/object";
import type { PrintableDef } from "@/core/print";

/** Druhy dokladů — hodnoty doplní registr z `ModuleDef.printables`. */
export const PrintDocType = defineEnum({ id: "PrtDocType", label: "@PRT:DocType", values: [] });

export const Paper = defineEnum({
  id: "PrtPaper",
  label: "@PRT:Paper",
  values: [
    { value: "a4", label: "@PRT:PaperA4" },
    { value: "a5", label: "@PRT:PaperA5" },
    { value: "receipt80", label: "@PRT:PaperReceipt80" },
    { value: "receipt58", label: "@PRT:PaperReceipt58" },
    { value: "label", label: "@PRT:PaperLabel" },
  ],
});

export const template = defineObject({
  id: "prt.template",
  table: "prt_template",
  label: "@PRT:Template",
  labelPlural: "@PRT:Templates",
  scope: "company",
  shareable: true,
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    docType: { edt: enumEdt(PrintDocType), mandatory: true },
    paper: { edt: enumEdt(Paper), mandatory: true, default: "a4" },
    isDefault: { edt: Edts.NoYes, label: "@PRT:IsDefault" },
    // rozvržení (JSON) upravuje návrhář, ve formuláři se neukazuje
    layout: { edt: Edts.Notes, label: "@PRT:Layout" },
  },
  titleField: "code",
  list: ["code", "name", "docType", "paper", "isDefault"],
  form: [{ label: "@SYS:General", fields: ["code", "name", "docType", "paper", "isDefault"] }],
  unique: [["code"]],
  defaultSort: { field: "docType", dir: "asc" },
});

/** Výchozí šablony tisknutelných dokladů modulu (jen chybějící druh); `name` = přeložený název. */
export async function setupPrintTemplates(data: DataApi, printables: (PrintableDef & { name: string })[]) {
  for (const p of printables) {
    const existing = await data.find("prt.template", { docType: p.id }, { take: 50 });
    // neupravená šablona v původní podobě → nové výchozí rozvržení (upravené se nemění)
    if (p.legacyLayouts?.length) {
      const old = new Set(p.legacyLayouts.map((l) => JSON.stringify(l)));
      for (const t of existing) if (old.has(String(t.layout))) await data.update("prt.template", String(t.id), { layout: JSON.stringify(p.defaultLayout()) });
      // upravená šablona zůstane; nové rozvržení přibude jako další šablona na výběr
      const now = JSON.stringify(p.defaultLayout());
      const code2 = `${p.id.split(".").pop()!.toUpperCase().slice(0, 16)}-2026`;
      const all = await data.find("prt.template", { docType: p.id }, { take: 50 });
      if (all.length && !all.some((t) => String(t.layout) === now || t.code === code2)) {
        await data.create("prt.template", { code: code2, name: `${p.name} 2026`, docType: p.id, paper: p.defaultLayout().paper, isDefault: false, layout: now });
      }
    }
    if (existing.length) continue;
    const layout = p.defaultLayout();
    const code = p.id.split(".").pop()!.toUpperCase().slice(0, 20);
    await data.create("prt.template", { code, name: p.name, docType: p.id, paper: layout.paper, isDefault: true, layout: JSON.stringify(layout) });
  }
}

export const prtHandlers: Record<string, ObjectHandlers> = {
  "prt.template": {
    async beforeSave(ctx, d) {
      // výchozí může být jen jedna šablona druhu
      if (d.isDefault && d.docType) {
        for (const o of await ctx.data.find("prt.template", { docType: d.docType, isDefault: true }, { take: 20 })) {
          if (o.id !== d.id) await ctx.data.update("prt.template", String(o.id), { isDefault: false });
        }
      }
      if (d.layout) {
        try {
          JSON.parse(String(d.layout));
        } catch {
          return { layout: "@PRT:LayoutInvalid" };
        }
      }
    },
  },
};

export default defineModule({
  id: "prt",
  label: "@PRT:Module",
  description: "@PRT:ModuleDesc",
  icon: "Print",
  dependsOn: ["sys"],
  enums: [PrintDocType, Paper],
  objects: [template],
  menu: [
    { label: "@PRT:Module", items: [{ href: "/print/designer", label: "@PRT:Designer" }, { object: "prt.template" }] },
  ],
  labels: {
    cs: {
      DocAdvance: "Zálohová faktura / daňový doklad k platbě",
      DocTitle: "Nadpis dokladu",
      AdvanceNum: "Číslo zálohy",
      Pdf: "PDF",
      Module: "Tiskové sestavy",
      ModuleDesc: "Šablony faktur, účtenek a dalších dokladů, návrhář a tisk do PDF.",
      Template: "Šablona",
      Templates: "Šablony dokladů",
      DocType: "Druh dokladu",
      Paper: "Papír",
      PaperA4: "A4",
      PaperA5: "A5",
      PaperReceipt80: "Účtenka 80 mm",
      PaperReceipt58: "Účtenka 58 mm",
      PaperLabel: "Štítek 100×60 mm",
      IsDefault: "Výchozí",
      Layout: "Rozvržení",
      LayoutInvalid: "Rozvržení není platné.",
      Designer: "Návrhář sestav",
      DocInvoice: "Faktura vydaná",
      DocReceipt: "Účtenka",
      CompanyName: "Firma – název",
      TradeName: "Firma – obchodní značka",
      CompanyAddress: "Firma – adresa",
      CompanyRegNo: "Firma – IČO",
      CompanyVatId: "Firma – DIČ",
      Registration: "Firma – zápis v rejstříku",
      BankAccount: "Firma – bankovní účet",
      Iban: "Firma – IBAN",
      Email: "Firma – e-mail",
      Phone: "Firma – telefon",
      Web: "Firma – web",
      DocNumber: "Číslo dokladu",
      DocDate: "Datum vystavení",
      TaxDate: "Datum zdanitelného plnění",
      DueDate: "Datum splatnosti",
      DateTime: "Datum a čas",
      Vs: "Variabilní symbol",
      Description: "Popis",
      Currency: "Měna",
      Net: "Základ",
      Tax: "DPH",
      Gross: "Celkem",
      Paid: "Zaplaceno",
      Due: "K úhradě",
      Rounding: "Zaokrouhlení",
      Payment: "Způsob platby",
      CashGiven: "Přijato",
      Change: "Vráceno",
      Fik: "FIK (EET)",
      Footer: "Patička pokladny",
      Register: "Pokladna",
      PartnerNumber: "Odběratel – číslo",
      PartnerName: "Odběratel – název",
      PartnerAddress: "Odběratel – adresa",
      PartnerRegNo: "Odběratel – IČO",
      PartnerVatId: "Odběratel – DIČ",
      LineDescription: "Položka",
      LineQty: "Množství",
      LineUnit: "MJ",
      LineUnitPrice: "Cena za MJ",
      LineRate: "Sazba DPH",
      Print: "Tisk",
      PrintPdf: "Tisk / PDF",
      Preview: "Náhled",
      Design: "Návrh",
      AddText: "Text",
      AddTable: "Tabulka řádků",
      AddVat: "Rekapitulace DPH",
      AddQr: "QR platba",
      AddImage: "Obrázek / logo",
      AddLine: "Čára",
      AddRect: "Rámeček",
      InsertField: "Vložit pole",
      Columns: "Sloupce",
      AddColumn: "Přidat sloupec",
      FontSize: "Velikost písma",
      Bold: "Tučně",
      Align: "Zarovnání",
      Left: "Vlevo",
      Center: "Na střed",
      Right: "Vpravo",
      Border: "Rámeček",
      Text: "Text",
      Field: "Pole",
      Width: "Šířka",
      Header: "Záhlaví",
      Format: "Formát",
      Remove: "Odebrat",
      UploadImage: "Nahrát obrázek",
      ImageTooBig: "Obrázek je větší než 300 kB.",
      Record: "Doklad pro náhled",
      NoRecord: "Bez dokladu (jen rozvržení)",
      NewTemplate: "Nová šablona",
      Saved: "Šablona uložena.",
      SelectElement: "Vyberte prvek na plátně, nebo přidejte nový.",
      DefaultTemplateMissing: "Pro tento druh dokladu není šablona — založte ji v Tiskové sestavy.",
      Template1: "Šablona",
      Back: "Zpět",
    },
    en: {
      DocAdvance: "Advance invoice / tax document for payment",
      DocTitle: "Document title",
      AdvanceNum: "Advance number",
      Pdf: "PDF",
      Module: "Print layouts",
      ModuleDesc: "Templates for invoices, receipts and other documents, designer and PDF printing.",
      Template: "Template",
      Templates: "Document templates",
      DocType: "Document type",
      Paper: "Paper",
      PaperA4: "A4",
      PaperA5: "A5",
      PaperReceipt80: "Receipt 80 mm",
      PaperReceipt58: "Receipt 58 mm",
      PaperLabel: "Label 100×60 mm",
      IsDefault: "Default",
      Layout: "Layout",
      LayoutInvalid: "The layout is not valid.",
      Designer: "Layout designer",
      DocInvoice: "Sales invoice",
      DocReceipt: "Receipt",
      CompanyName: "Company – name",
      TradeName: "Company – trade name",
      CompanyAddress: "Company – address",
      CompanyRegNo: "Company – ID",
      CompanyVatId: "Company – VAT ID",
      Registration: "Company – registration",
      BankAccount: "Company – bank account",
      Iban: "Company – IBAN",
      Email: "Company – e-mail",
      Phone: "Company – phone",
      Web: "Company – web",
      DocNumber: "Document number",
      DocDate: "Issue date",
      TaxDate: "Tax point date",
      DueDate: "Due date",
      DateTime: "Date and time",
      Vs: "Variable symbol",
      Description: "Description",
      Currency: "Currency",
      Net: "Net",
      Tax: "VAT",
      Gross: "Total",
      Paid: "Paid",
      Due: "Amount due",
      Rounding: "Rounding",
      Payment: "Payment method",
      CashGiven: "Received",
      Change: "Change",
      Fik: "FIK (EET)",
      Footer: "Register footer",
      Register: "Register",
      PartnerNumber: "Customer – number",
      PartnerName: "Customer – name",
      PartnerAddress: "Customer – address",
      PartnerRegNo: "Customer – ID",
      PartnerVatId: "Customer – VAT ID",
      LineDescription: "Item",
      LineQty: "Quantity",
      LineUnit: "Unit",
      LineUnitPrice: "Unit price",
      LineRate: "VAT rate",
      Print: "Print",
      PrintPdf: "Print / PDF",
      Preview: "Preview",
      Design: "Design",
      AddText: "Text",
      AddTable: "Line table",
      AddVat: "VAT summary",
      AddQr: "QR payment",
      AddImage: "Image / logo",
      AddLine: "Line",
      AddRect: "Box",
      InsertField: "Insert field",
      Columns: "Columns",
      AddColumn: "Add column",
      FontSize: "Font size",
      Bold: "Bold",
      Align: "Alignment",
      Left: "Left",
      Center: "Center",
      Right: "Right",
      Border: "Border",
      Text: "Text",
      Field: "Field",
      Width: "Width",
      Header: "Header",
      Format: "Format",
      Remove: "Remove",
      UploadImage: "Upload image",
      ImageTooBig: "The image is larger than 300 kB.",
      Record: "Document for preview",
      NoRecord: "No document (layout only)",
      NewTemplate: "New template",
      Saved: "Template saved.",
      SelectElement: "Select an element on the canvas, or add a new one.",
      DefaultTemplateMissing: "There is no template for this document type — create one in Print layouts.",
      Template1: "Template",
      Back: "Back",
    },
  },
});
