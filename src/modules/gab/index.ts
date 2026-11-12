import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule } from "@/core/module";
import { defineObject } from "@/core/object";

export const SubjectType = defineEnum({
  id: "SubjectType",
  label: "@GAB:SubjectType",
  values: [
    { value: "organization", label: "@GAB:Organization" },
    { value: "person", label: "@GAB:Person" },
  ],
});

export const AddressKind = defineEnum({
  id: "AddressKind",
  label: "@GAB:AddressKind",
  values: [
    { value: "registered", label: "@GAB:Registered" },
    { value: "invoice", label: "@GAB:InvoiceAddr" },
    { value: "delivery", label: "@GAB:Delivery" },
  ],
});

export const ContactKind = defineEnum({
  id: "ContactKind",
  label: "@GAB:ContactKind",
  values: [
    { value: "email", label: "@SYS:Email" },
    { value: "phone", label: "@SYS:Phone" },
    { value: "web", label: "@GAB:Web" },
  ],
});

const Street = defineEdt({ id: "Street", kind: "string", label: "@GAB:Street", maxLength: 120 });
const City = defineEdt({ id: "City", kind: "string", label: "@GAB:City", maxLength: 80 });
const ZipCode = defineEdt({ id: "ZipCode", kind: "string", label: "@GAB:ZipCode", maxLength: 10 });
const ContactValue = defineEdt({ id: "ContactValue", kind: "string", label: "@GAB:ContactValue", maxLength: 254 });
const SubjectRef = refEdt("gab.subject", "@GAB:Subject");

export const subject = defineObject({
  id: "gab.subject",
  table: "gab_subject",
  label: "@GAB:Subject",
  labelPlural: "@GAB:Subjects",
  scope: "tenant",
  fields: {
    name: { edt: Edts.Name, mandatory: true },
    type: { edt: enumEdt(SubjectType), mandatory: true, default: "organization" },
    regNo: { edt: Edts.RegNo },
    vatId: { edt: Edts.VatId },
    email: { edt: Edts.Email },
    phone: { edt: Edts.Phone },
    country: { edt: Edts.CountryCode, default: "CZ" },
    notes: { edt: Edts.Notes },
  },
  titleField: "name",
  list: ["name", "type", "regNo", "vatId", "email", "phone"],
  form: [
    { label: "@SYS:General", fields: ["name", "type", "country"] },
    { label: "@SYS:Identification", fields: ["regNo", "vatId"] },
    { label: "@GAB:Contacts", fields: ["email", "phone", "notes"] },
  ],
  defaultSort: { field: "name", dir: "asc" },
  lines: [
    { object: "gab.address", field: "subjectId", label: "@GAB:Addresses" },
    { object: "gab.contact", field: "subjectId", label: "@GAB:Contacts" },
  ],
});

export const address = defineObject({
  id: "gab.address",
  table: "gab_address",
  label: "@GAB:Address",
  labelPlural: "@GAB:Addresses",
  scope: "tenant",
  fields: {
    subjectId: { edt: SubjectRef, mandatory: true },
    kind: { edt: enumEdt(AddressKind), mandatory: true, default: "registered" },
    street: { edt: Street },
    city: { edt: City, mandatory: true },
    zipCode: { edt: ZipCode },
    country: { edt: Edts.CountryCode, mandatory: true, default: "CZ" },
  },
  titleField: "city",
  list: ["subjectId", "kind", "street", "city", "zipCode", "country"],
  form: [{ label: "@SYS:General", fields: ["subjectId", "kind", "street", "city", "zipCode", "country"] }],
  defaultSort: { field: "city", dir: "asc" },
});

export const contact = defineObject({
  id: "gab.contact",
  table: "gab_contact",
  label: "@GAB:Contact",
  labelPlural: "@GAB:Contacts",
  scope: "tenant",
  fields: {
    subjectId: { edt: SubjectRef, mandatory: true },
    kind: { edt: enumEdt(ContactKind), mandatory: true, default: "email" },
    value: { edt: ContactValue, mandatory: true },
    description: { edt: Edts.Description },
  },
  titleField: "value",
  list: ["subjectId", "kind", "value", "description"],
  form: [{ label: "@SYS:General", fields: ["subjectId", "kind", "value", "description"] }],
  defaultSort: { field: "value", dir: "asc" },
});

export default defineModule({
  id: "gab",
  label: "@GAB:Module",
  description: "@GAB:ModuleDesc",
  icon: "BuildingBank",
  dependsOn: ["sys"],
  enums: [SubjectType, AddressKind, ContactKind],
  objects: [subject, address, contact],
  menu: [{ label: "@GAB:Module", items: [{ object: "gab.subject" }] }],
  labels: {
    cs: {
      Module: "Adresář",
      ModuleDesc: "Společný adresář firem a osob — odběratelé, dodavatelé, zaměstnanci.",
      Subject: "Subjekt",
      Subjects: "Subjekty",
      SubjectType: "Typ",
      Organization: "Organizace",
      Person: "Osoba",
      Address: "Adresa",
      Addresses: "Adresy",
      AddressKind: "Druh adresy",
      Registered: "Sídlo",
      InvoiceAddr: "Fakturační",
      Delivery: "Doručovací",
      Street: "Ulice",
      City: "Obec",
      ZipCode: "PSČ",
      Contact: "Kontakt",
      Contacts: "Kontakty",
      ContactKind: "Druh kontaktu",
      ContactValue: "Hodnota",
      Web: "Web",
    },
    en: {
      Module: "Address book",
      ModuleDesc: "Shared address book of organizations and people — customers, vendors, employees.",
      Subject: "Party",
      Subjects: "Parties",
      SubjectType: "Type",
      Organization: "Organization",
      Person: "Person",
      Address: "Address",
      Addresses: "Addresses",
      AddressKind: "Address type",
      Registered: "Registered",
      InvoiceAddr: "Invoice",
      Delivery: "Delivery",
      Street: "Street",
      City: "City",
      ZipCode: "ZIP code",
      Contact: "Contact",
      Contacts: "Contacts",
      ContactKind: "Contact type",
      ContactValue: "Value",
      Web: "Web",
    },
  },
});
