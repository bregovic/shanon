/**
 * Zaměstnanci (hr) — karta zaměstnance ve firmě (= úvazek) a přístup do aplikace Portál.
 *
 * Identita napříč firmami: stejné osobní číslo v několika firmách tenanta = jeden člověk s jedním
 * přihlášením do Portálu (účet `sys_portal_account`, osobní číslo + heslo), firmy = jeho platné karty.
 * Účtenky, které zaměstnanec zaplatil, se zalistují na dodavatele zaměstnance (profil ZAM, 333)
 * a proplatí platebním příkazem. Fáze 2: dovolená, absence, docházka, výkaz.
 */
import { defineEdt, Edts, refEdt } from "@/core/edt";
import { defineModule } from "@/core/module";
import { defineObject } from "@/core/object";

const PersonalNum = defineEdt({ id: "HrPersonalNum", kind: "string", label: "@HR:PersonalNum", maxLength: 20, pattern: /^[A-Za-z0-9._-]{1,20}$/, patternMessage: "@HR:PersonalNumHelp", transform: "upper" });

export const employee = defineObject({
  id: "hr.employee",
  table: "hr_employee",
  label: "@HR:Employee",
  labelPlural: "@HR:Employees",
  scope: "company",
  fields: {
    personalNum: { edt: PersonalNum, mandatory: true, help: "@HR:PersonalNumHelp" },
    firstName: { edt: Edts.Name, label: "@HR:FirstName", mandatory: true },
    lastName: { edt: Edts.Name, label: "@HR:LastName", mandatory: true },
    name: { edt: Edts.Name, readOnly: true },
    email: { edt: Edts.Email, help: "@HR:EmailHelp" },
    phone: { edt: Edts.Phone },
    position: { edt: Edts.Description, label: "@HR:Position" },
    validFrom: { edt: Edts.TransDate, label: "@HR:ValidFrom" },
    validTo: { edt: Edts.TransDate, label: "@HR:ValidTo" },
    active: { edt: Edts.NoYes, default: true },
    /** přístup do aplikace Portál (účtenky, později žádosti) */
    portalAccess: { edt: Edts.NoYes, label: "@HR:PortalAccess", default: true },
    /** dodavatel pro proplácení výdajů (profil ZAM) — založí se s první účtenkou */
    vendorId: { edt: refEdt("ap.vendor", "@HR:Vendor"), optionalRef: true, readOnly: true },
    portalInvitedAt: { edt: Edts.DateTime, label: "@HR:PortalInvitedAt", readOnly: true },
    portalLastLogin: { edt: Edts.DateTime, label: "@HR:PortalLastLogin", readOnly: true },
    note: { edt: Edts.Notes },
  },
  titleField: "personalNum",
  list: ["personalNum", "name", "email", "position", "validFrom", "validTo", "active", "portalAccess", "portalLastLogin"],
  form: [
    { label: "@HR:Employee", fields: ["personalNum", "firstName", "lastName", "email", "phone", "position", "validFrom", "validTo", "active"] },
    { label: "@HR:Portal", fields: ["portalAccess", "portalInvitedAt", "portalLastLogin", "vendorId"] },
    { label: "@SYS:Notes", fields: ["note"] },
  ],
  unique: [["personalNum"]],
  defaultSort: { field: "personalNum", dir: "asc" },
  actions: [
    { id: "invite", label: "@HR:Invite", icon: "mail", outside: true, bulk: true },
  ],
});

export default defineModule({
  id: "hr",
  label: "@HR:Module",
  description: "@HR:ModuleDesc",
  icon: "People",
  dependsOn: ["sys"],
  objects: [employee],
  menu: [{ label: "@HR:Module", items: [{ object: "hr.employee" }] }],
  labels: {
    cs: {
      Module: "Zaměstnanci",
      ModuleDesc: "Karty zaměstnanců a přístup do aplikace Portál (účtenky, žádosti)",
      Employee: "Zaměstnanec",
      Employees: "Zaměstnanci",
      PersonalNum: "Osobní číslo",
      PersonalNumHelp: "Písmena, číslice, tečka, pomlčka (do 20 znaků). Stejné číslo v jiné firmě = tentýž člověk s jedním přihlášením.",
      FirstName: "Jméno",
      LastName: "Příjmení",
      EmailHelp: "Na tento e-mail přijde pozvánka do Portálu.",
      Position: "Pozice",
      ValidFrom: "Úvazek od",
      ValidTo: "Úvazek do",
      Portal: "Portál",
      PortalAccess: "Přístup do Portálu",
      Vendor: "Dodavatel pro proplácení",
      PortalInvitedAt: "Pozvánka odeslána",
      PortalLastLogin: "Poslední přihlášení",
      Invite: "Poslat pozvánku do Portálu",
      InviteNoEmail: "Zaměstnanec {num} nemá e-mail.",
      InviteNoAccess: "Zaměstnanec {num} nemá přístup do Portálu.",
      InviteSent: "Pozvánka odeslána: {email}",
    },
    en: {
      Module: "Employees",
      ModuleDesc: "Employee cards and access to the Portal app (receipts, requests)",
      Employee: "Employee",
      Employees: "Employees",
      PersonalNum: "Personal number",
      PersonalNumHelp: "Letters, digits, dot, dash (up to 20). The same number in another company = the same person with one sign-in.",
      FirstName: "First name",
      LastName: "Last name",
      EmailHelp: "The Portal invitation is sent to this e-mail.",
      Position: "Position",
      ValidFrom: "Employed from",
      ValidTo: "Employed to",
      Portal: "Portal",
      PortalAccess: "Portal access",
      Vendor: "Vendor for reimbursement",
      PortalInvitedAt: "Invitation sent",
      PortalLastLogin: "Last sign-in",
      Invite: "Send Portal invitation",
      InviteNoEmail: "Employee {num} has no e-mail.",
      InviteNoAccess: "Employee {num} has no Portal access.",
      InviteSent: "Invitation sent: {email}",
    },
  },
});
