/**
 * Testování a vývoj: klíčové funkce (oblasti) se stavem, testovací scénáře
 * (FAT u dodavatele, UAT u zákazníka) a požadavky — změny, chyby, úkoly.
 * Obdoba Task recorder / Regression suite + backlogu v Lifecycle Services.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule, type ObjectHandlers } from "@/core/module";
import { defineObject } from "@/core/object";

export const FeatureStatus = defineEnum({
  id: "QaFeatureStatus",
  label: "@QA:FeatureStatus",
  values: [
    { value: "planned", label: "@QA:Planned" },
    { value: "development", label: "@QA:Development" },
    { value: "fat", label: "@QA:Fat" },
    { value: "uat", label: "@QA:Uat" },
    { value: "live", label: "@QA:Live" },
  ],
});

export const TestStage = defineEnum({
  id: "QaStage",
  label: "@QA:Stage",
  values: [
    { value: "fat", label: "@QA:Fat" },
    { value: "uat", label: "@QA:Uat" },
  ],
});

export const TestResult = defineEnum({
  id: "QaResult",
  label: "@QA:Result",
  values: [
    { value: "notRun", label: "@QA:NotRun" },
    { value: "passed", label: "@QA:Passed" },
    { value: "failed", label: "@QA:Failed" },
    { value: "blocked", label: "@QA:Blocked" },
  ],
});

export const IssueType = defineEnum({
  id: "QaIssueType",
  label: "@QA:IssueType",
  values: [
    { value: "change", label: "@QA:Change" },
    { value: "bug", label: "@QA:Bug" },
    { value: "task", label: "@QA:Task" },
  ],
});

export const Priority = defineEnum({
  id: "QaPriority",
  label: "@QA:Priority",
  values: [
    { value: "low", label: "@QA:Low" },
    { value: "medium", label: "@QA:Medium" },
    { value: "high", label: "@QA:High" },
    { value: "critical", label: "@QA:Critical" },
  ],
});

export const IssueStatus = defineEnum({
  id: "QaIssueStatus",
  label: "@QA:IssueStatus",
  values: [
    { value: "new", label: "@QA:New" },
    { value: "analysis", label: "@QA:Analysis" },
    { value: "development", label: "@QA:Development" },
    { value: "fat", label: "@QA:Fat" },
    { value: "uat", label: "@QA:Uat" },
    { value: "done", label: "@QA:Done" },
    { value: "rejected", label: "@QA:Rejected" },
  ],
});

const Text = (id: string, label: string, max = 120) => defineEdt({ id, kind: "string", label, maxLength: max, transform: "trim" });

export const feature = defineObject({
  id: "qa.feature",
  table: "qa_feature",
  label: "@QA:Feature",
  labelPlural: "@QA:Features",
  scope: "tenant",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    name: { edt: Edts.Name, mandatory: true },
    area: { edt: Text("QaArea", "@QA:Area", 60), aliases: ["modul", "module", "oblast"] },
    status: { edt: enumEdt(FeatureStatus), mandatory: true, default: "planned" },
    owner: { edt: Text("QaOwner", "@QA:Owner", 120) },
    description: { edt: Edts.Notes, label: "@QA:DescriptionGroup", aliases: ["popis", "description"] },
  },
  titleField: "code",
  list: ["code", "name", "area", "status", "owner"],
  form: [
    { label: "@SYS:General", fields: ["code", "name", "area", "status", "owner"] },
    { label: "@QA:DescriptionGroup", fields: ["description"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
  lines: [
    { object: "qa.scenario", field: "featureId", label: "@QA:Scenarios", owned: false },
    { object: "qa.issue", field: "featureId", label: "@QA:Issues", owned: false },
  ],
});

export const scenario = defineObject({
  id: "qa.scenario",
  table: "qa_scenario",
  label: "@QA:Scenario",
  labelPlural: "@QA:Scenarios",
  scope: "tenant",
  fields: {
    code: { edt: Edts.Code, mandatory: true },
    title: { edt: Edts.Description, label: "@QA:Title", mandatory: true },
    featureId: { edt: refEdt("qa.feature", "@QA:Feature"), mandatory: true },
    stage: { edt: enumEdt(TestStage), mandatory: true, default: "fat" },
    steps: { edt: Edts.Notes, label: "@QA:Steps" },
    expected: { edt: Edts.Notes, label: "@QA:Expected" },
    result: { edt: enumEdt(TestResult), mandatory: true, default: "notRun" },
    testedAt: { edt: Edts.TransDate, label: "@QA:TestedAt" },
    tester: { edt: Text("QaTester", "@QA:Tester", 120) },
    note: { edt: Edts.Notes, label: "@QA:Note" },
  },
  titleField: "code",
  list: ["code", "title", "featureId", "stage", "result", "testedAt", "tester"],
  form: [
    { label: "@SYS:General", fields: ["code", "title", "featureId", "stage"] },
    { label: "@QA:Scenario", fields: ["steps", "expected"] },
    { label: "@QA:Result", fields: ["result", "testedAt", "tester", "note"] },
  ],
  unique: [["code"]],
  defaultSort: { field: "code", dir: "asc" },
});

export const issue = defineObject({
  id: "qa.issue",
  table: "qa_issue",
  label: "@QA:Issue",
  labelPlural: "@QA:Issues",
  scope: "tenant",
  fields: {
    issueNum: { edt: Edts.Code, label: "@QA:IssueNum", mandatory: true },
    type: { edt: enumEdt(IssueType), mandatory: true, default: "change" },
    title: { edt: Edts.Description, label: "@QA:Title", mandatory: true },
    featureId: { edt: refEdt("qa.feature", "@QA:Feature") },
    scenarioId: { edt: refEdt("qa.scenario", "@QA:Scenario") },
    priority: { edt: enumEdt(Priority), mandatory: true, default: "medium" },
    status: { edt: enumEdt(IssueStatus), mandatory: true, default: "new" },
    order: { edt: Edts.Int, label: "@QA:Order" },
    reportedBy: { edt: Text("QaReporter", "@QA:ReportedBy", 120) },
    assignedTo: { edt: Text("QaAssignee", "@QA:AssignedTo", 120) },
    dueDate: { edt: Edts.TransDate, label: "@QA:DueDate" },
    description: { edt: Edts.Notes, label: "@QA:DescriptionGroup", aliases: ["popis", "description"] },
    resolution: { edt: Edts.Notes, label: "@QA:Resolution" },
  },
  titleField: "issueNum",
  list: ["issueNum", "type", "title", "featureId", "priority", "status", "order", "assignedTo", "dueDate"],
  form: [
    { label: "@SYS:General", fields: ["issueNum", "type", "title", "featureId", "scenarioId", "priority", "status", "order"] },
    { label: "@QA:Responsibility", fields: ["reportedBy", "assignedTo", "dueDate"] },
    { label: "@QA:DescriptionGroup", fields: ["description", "resolution"] },
  ],
  unique: [["issueNum"]],
  numberSeq: { field: "issueNum", seq: "QAISSUE" },
  defaultSort: { field: "order", dir: "asc" },
});

/** Testovaný scénář dostane datum, pokud ho tester nevyplnil. */
export const qaHandlers: Record<string, ObjectHandlers> = {
  "qa.scenario": {
    beforeSave(_ctx, d) {
      if (d.result && d.result !== "notRun" && !d.testedAt) d.testedAt = new Date().toISOString().slice(0, 10);
    },
  },
};

export default defineModule({
  id: "qa",
  label: "@QA:Module",
  description: "@QA:ModuleDesc",
  icon: "Beaker",
  dependsOn: ["sys"],
  enums: [FeatureStatus, TestStage, TestResult, IssueType, Priority, IssueStatus],
  objects: [feature, scenario, issue],
  menu: [
    { label: "@QA:Module", items: [{ object: "qa.issue" }, { object: "qa.scenario" }] },
    { label: "@SYS:Setup", items: [{ object: "qa.feature" }] },
  ],
  // řada je per firma (číselné řady patří firmě); požadavky jsou sdílené v tenantovi
  numberSeqs: [{ code: "QAISSUE", name: "@QA:Issues", format: "CR{YY}-{####}", usedFor: "qa.issue" }],
  labels: {
    cs: {
      Module: "Testování a vývoj",
      ModuleDesc: "Klíčové funkce a jejich stav, testovací scénáře FAT/UAT, požadavky na změny a chyby.",
      Feature: "Funkce",
      Features: "Klíčové funkce",
      FeatureStatus: "Stav funkce",
      Area: "Oblast / modul",
      Owner: "Garant",
      Planned: "Plánováno",
      Development: "Vývoj",
      Fat: "FAT",
      Uat: "UAT",
      Live: "V provozu",
      Scenario: "Testovací scénář",
      Scenarios: "Testovací scénáře",
      Stage: "Fáze testu",
      Steps: "Postup",
      Expected: "Očekávaný výsledek",
      Result: "Výsledek",
      NotRun: "Netestováno",
      Passed: "Prošlo",
      Failed: "Neprošlo",
      Blocked: "Blokováno",
      TestedAt: "Testováno dne",
      Tester: "Tester",
      Note: "Poznámka",
      Issue: "Požadavek",
      Issues: "Požadavky a chyby",
      IssueNum: "Číslo",
      IssueType: "Typ",
      Change: "Změna (CR)",
      Bug: "Chyba",
      Task: "Úkol",
      Title: "Název",
      Priority: "Priorita",
      Low: "Nízká",
      Medium: "Střední",
      High: "Vysoká",
      Critical: "Kritická",
      IssueStatus: "Stav",
      New: "Nový",
      Analysis: "Analýza",
      Done: "Hotovo",
      Rejected: "Zamítnuto",
      Order: "Pořadí",
      ReportedBy: "Zadal",
      AssignedTo: "Řeší",
      DueDate: "Termín",
      Resolution: "Řešení",
      Responsibility: "Odpovědnost",
      DescriptionGroup: "Popis",
    },
    en: {
      Module: "Testing and development",
      ModuleDesc: "Key features and their status, FAT/UAT test scenarios, change requests and bugs.",
      Feature: "Feature",
      Features: "Key features",
      FeatureStatus: "Feature status",
      Area: "Area / module",
      Owner: "Owner",
      Planned: "Planned",
      Development: "Development",
      Fat: "FAT",
      Uat: "UAT",
      Live: "Live",
      Scenario: "Test scenario",
      Scenarios: "Test scenarios",
      Stage: "Test stage",
      Steps: "Steps",
      Expected: "Expected result",
      Result: "Result",
      NotRun: "Not run",
      Passed: "Passed",
      Failed: "Failed",
      Blocked: "Blocked",
      TestedAt: "Tested on",
      Tester: "Tester",
      Note: "Note",
      Issue: "Request",
      Issues: "Requests and bugs",
      IssueNum: "Number",
      IssueType: "Type",
      Change: "Change (CR)",
      Bug: "Bug",
      Task: "Task",
      Title: "Title",
      Priority: "Priority",
      Low: "Low",
      Medium: "Medium",
      High: "High",
      Critical: "Critical",
      IssueStatus: "Status",
      New: "New",
      Analysis: "Analysis",
      Done: "Done",
      Rejected: "Rejected",
      Order: "Order",
      ReportedBy: "Reported by",
      AssignedTo: "Assigned to",
      DueDate: "Due date",
      Resolution: "Resolution",
      Responsibility: "Responsibility",
      DescriptionGroup: "Description",
    },
  },
});
