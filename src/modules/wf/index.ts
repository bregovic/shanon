/**
 * Workflow — pracovní položky (úkoly) a později schvalování (CR-098).
 *
 * Pracovní položka = obecný úkol pro člověka: co udělat, komu (uživatel), odkaz na záznam libovolného
 * objektu (`refObject` + `refId`), druh, stav, termín, výsledek. Zakládá je logika modulů přes
 * `createWorkItem` (src/modules/wf/work.ts) — vytěžování dokladů, později kroky schvalování.
 * Přehled „Moje úkoly“ je na úvodní stránce aplikace.
 */
import { defineEdt, defineEnum, Edts, enumEdt } from "@/core/edt";
import { defineModule } from "@/core/module";
import { defineObject } from "@/core/object";

export const WorkItemKind = defineEnum({
  id: "WfWorkItemKind",
  label: "@WF:Kind",
  values: [
    { value: "task", label: "@WF:KindTask", color: "subtle" },
    { value: "fix", label: "@WF:KindFix", color: "warning" },
    { value: "review", label: "@WF:KindReview", color: "brand" },
    { value: "approval", label: "@WF:KindApproval", color: "important" },
  ],
});

export const WorkItemStatus = defineEnum({
  id: "WfWorkItemStatus",
  label: "@WF:Status",
  values: [
    { value: "open", label: "@WF:StatusOpen", color: "warning" },
    { value: "done", label: "@WF:StatusDone", color: "success" },
    { value: "rejected", label: "@WF:StatusRejected", color: "danger" },
    { value: "cancelled", label: "@WF:StatusCancelled", color: "subtle" },
  ],
});

const RefObject = defineEdt({ id: "WfRefObject", kind: "string", label: "@WF:RefObject", maxLength: 60 });
const RefId = defineEdt({ id: "WfRefId", kind: "string", label: "@WF:RefId", maxLength: 36 });
const RefTitle = defineEdt({ id: "WfRefTitle", kind: "string", label: "@WF:Record", maxLength: 120 });
const Href = defineEdt({ id: "WfHref", kind: "string", label: "@WF:Href", maxLength: 255 });
const SourceKey = defineEdt({ id: "WfSourceKey", kind: "string", label: "@WF:SourceKey", maxLength: 120 });

export const workItem = defineObject({
  id: "wf.workItem",
  table: "wf_work_item",
  label: "@WF:WorkItem",
  labelPlural: "@WF:WorkItems",
  scope: "company",
  fields: {
    title: { edt: Edts.Name, label: "@WF:Title", mandatory: true },
    kind: { edt: enumEdt(WorkItemKind), mandatory: true, default: "task" },
    status: { edt: enumEdt(WorkItemStatus), mandatory: true, default: "open" },
    assignedTo: { edt: Edts.User, label: "@WF:AssignedTo" },
    dueDate: { edt: Edts.TransDate, label: "@WF:DueDate" },
    description: { edt: Edts.Notes, label: "@WF:Description" },
    refObject: { edt: RefObject, readOnly: true },
    refId: { edt: RefId, readOnly: true },
    refTitle: { edt: RefTitle, readOnly: true },
    href: { edt: Href, readOnly: true },
    /** zdroj a klíč pro dohledání (int.document:<id>:fix) — otevřený úkol se stejným klíčem se nezakládá znovu */
    sourceKey: { edt: SourceKey, readOnly: true },
    result: { edt: Edts.Description, label: "@WF:Result" },
    completedAt: { edt: Edts.DateTime, label: "@WF:CompletedAt", readOnly: true },
    completedBy: { edt: Edts.User, label: "@WF:CompletedBy", readOnly: true },
  },
  titleField: "title",
  list: ["title", "kind", "status", "assignedTo", "refTitle", "dueDate"],
  form: [
    { label: "@WF:WorkItem", fields: ["title", "kind", "status", "assignedTo", "dueDate", "refTitle", "description"] },
    { label: "@WF:Result", fields: ["result", "completedAt", "completedBy"] },
  ],
  actions: [
    { id: "openRecord", label: "@WF:OpenRecord", group: "inquiry" },
    { id: "done", label: "@WF:Done", when: { field: "status", equals: "open" } },
    { id: "cancel", label: "@WF:Cancel", when: { field: "status", equals: "open" }, group: "more" },
  ],
  defaultSort: { field: "createdAt", dir: "desc" },
  indexes: [["assignedTo", "status"], ["sourceKey", "status"], ["refObject", "refId"]],
});

export default defineModule({
  id: "wf",
  label: "@WF:Module",
  description: "@WF:ModuleDesc",
  icon: "TaskList",
  dependsOn: ["sys"],
  enums: [WorkItemKind, WorkItemStatus],
  objects: [workItem],
  menu: [
    {
      label: "@WF:WorkItems",
      items: [
        { object: "wf.workItem", href: "/wf/workItem?filter.assignedTo=me&filter.status=open", label: "@WF:MyWorkItems" },
        { object: "wf.workItem", href: "/wf/workItem?filter.status=open", label: "@WF:OpenWorkItems" },
        { object: "wf.workItem" },
      ],
    },
  ],
  labels: {
    cs: {
      Module: "Workflow",
      ModuleDesc: "Úkoly k dokončení, kontrola a schvalování dokladů",
      WorkItem: "Pracovní položka",
      WorkItems: "Pracovní položky",
      MyWorkItems: "Moje úkoly",
      OpenWorkItems: "Otevřené úkoly",
      Title: "Úkol",
      Kind: "Druh",
      KindTask: "Úkol",
      KindFix: "Doplnit údaje",
      KindReview: "Kontrola",
      KindApproval: "Schválení",
      Status: "Stav",
      StatusOpen: "Otevřený",
      StatusDone: "Hotovo",
      StatusRejected: "Zamítnuto",
      StatusCancelled: "Zrušeno",
      AssignedTo: "Řešitel",
      DueDate: "Termín",
      Description: "Popis",
      RefObject: "Objekt",
      RefId: "Id záznamu",
      Record: "Záznam",
      Href: "Odkaz",
      SourceKey: "Klíč zdroje",
      Result: "Výsledek",
      CompletedAt: "Dokončeno",
      CompletedBy: "Dokončil",
      OpenRecord: "Otevřít záznam",
      Done: "Hotovo",
      Cancel: "Zrušit úkol",
      NoRecord: "Úkol nemá odkaz na záznam.",
      Overview: "Moje úkoly",
      OverviewEmpty: "Nemáte žádné otevřené úkoly.",
      OverviewUnassigned: "Nepřiřazené úkoly",
      OverviewAll: "Všechny úkoly",
      OverviewOverdue: "po termínu",
      NotifyAssigned: "Nový úkol: {title}",
    },
    en: {
      Module: "Workflow",
      ModuleDesc: "Tasks to complete, document review and approval",
      WorkItem: "Work item",
      WorkItems: "Work items",
      MyWorkItems: "My tasks",
      OpenWorkItems: "Open tasks",
      Title: "Task",
      Kind: "Kind",
      KindTask: "Task",
      KindFix: "Complete details",
      KindReview: "Review",
      KindApproval: "Approval",
      Status: "Status",
      StatusOpen: "Open",
      StatusDone: "Done",
      StatusRejected: "Rejected",
      StatusCancelled: "Cancelled",
      AssignedTo: "Assignee",
      DueDate: "Due date",
      Description: "Description",
      RefObject: "Object",
      RefId: "Record id",
      Record: "Record",
      Href: "Link",
      SourceKey: "Source key",
      Result: "Result",
      CompletedAt: "Completed",
      CompletedBy: "Completed by",
      OpenRecord: "Open record",
      Done: "Done",
      Cancel: "Cancel task",
      NoRecord: "The task has no linked record.",
      Overview: "My tasks",
      OverviewEmpty: "You have no open tasks.",
      OverviewUnassigned: "Unassigned tasks",
      OverviewAll: "All tasks",
      OverviewOverdue: "overdue",
      NotifyAssigned: "New task: {title}",
    },
  },
});
