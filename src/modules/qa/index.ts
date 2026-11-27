/**
 * Testování a vývoj: klíčové funkce (oblasti) se stavem, testovací scénáře
 * (FAT u dodavatele, UAT u zákazníka) a požadavky — změny, chyby, úkoly.
 * Obdoba Task recorder / Regression suite + backlogu v Lifecycle Services.
 */
import { Edts, defineEdt, defineEnum, enumEdt, refEdt } from "@/core/edt";
import { defineModule, type ObjectHandlers } from "@/core/module";
import { defineObject } from "@/core/object";
import { notify } from "@/modules/sys/notify";

export const FeatureStatus = defineEnum({
  id: "QaFeatureStatus",
  label: "@QA:FeatureStatus",
  values: [
    { value: "planned", label: "@QA:Planned", color: "subtle" },
    { value: "development", label: "@QA:Development", color: "warning" },
    { value: "fat", label: "@QA:Fat", color: "brand" },
    { value: "uat", label: "@QA:Uat", color: "important" },
    { value: "live", label: "@QA:Live", color: "success" },
  ],
});

export const TestStage = defineEnum({
  id: "QaStage",
  label: "@QA:Stage",
  values: [
    { value: "fat", label: "@QA:Fat", color: "brand" },
    { value: "uat", label: "@QA:Uat", color: "important" },
  ],
});

export const TestResult = defineEnum({
  id: "QaResult",
  label: "@QA:Result",
  values: [
    { value: "notRun", label: "@QA:NotRun", color: "subtle" },
    { value: "passed", label: "@QA:Passed", color: "success" },
    { value: "failed", label: "@QA:Failed", color: "danger" },
    { value: "blocked", label: "@QA:Blocked", color: "warning" },
  ],
});

export const IssueType = defineEnum({
  id: "QaIssueType",
  label: "@QA:IssueType",
  values: [
    { value: "change", label: "@QA:Change", color: "brand" },
    { value: "bug", label: "@QA:Bug", color: "danger" },
    { value: "task", label: "@QA:Task" },
  ],
});

export const Priority = defineEnum({
  id: "QaPriority",
  label: "@QA:Priority",
  values: [
    { value: "low", label: "@QA:Low", color: "subtle" },
    { value: "medium", label: "@QA:Medium", color: "informative" },
    { value: "high", label: "@QA:High", color: "warning" },
    { value: "critical", label: "@QA:Critical", color: "danger" },
  ],
});

export const IssueStatus = defineEnum({
  id: "QaIssueStatus",
  label: "@QA:IssueStatus",
  values: [
    { value: "new", label: "@QA:New", color: "informative" },
    { value: "analysis", label: "@QA:Analysis" },
    { value: "development", label: "@QA:Development", color: "warning" },
    { value: "returned", label: "@QA:Returned", color: "danger" },
    { value: "fat", label: "@QA:Fat", color: "brand" },
    { value: "uat", label: "@QA:Uat", color: "important" },
    { value: "done", label: "@QA:Done", color: "success" },
    { value: "rejected", label: "@QA:Rejected", color: "subtle" },
  ],
});

/** stav jedné opravy v souhrnném požadavku (kontrolní seznam) */
export const ItemStatus = defineEnum({
  id: "QaItemStatus",
  label: "@QA:ItemStatus",
  values: [
    { value: "todo", label: "@QA:ItemTodo", color: "subtle" },
    { value: "fixed", label: "@QA:ItemFixed", color: "important" },
    { value: "ok", label: "@QA:ItemOk", color: "success" },
    { value: "failing", label: "@QA:ItemFailing", color: "danger" },
  ],
});

const Text = (id: string, label: string, max = 120) => defineEdt({ id, kind: "string", label, maxLength: max, transform: "trim" });

/** Druh změny v deníku vývoje. */
export const ChangeKind = defineEnum({
  id: "QaChangeKind",
  label: "@QA:ChangeKind",
  values: [
    { value: "feature", label: "@QA:KindFeature", color: "brand" },
    { value: "change", label: "@QA:KindChange", color: "informative" },
    { value: "fix", label: "@QA:KindFix", color: "warning" },
  ],
});

/**
 * Deník vývoje: co se nasadilo na PROD a kdy — stručný nadpis, při rozkliknutí popis a použití.
 * Výchozí obsah v docs/qa/4-denik-vyvoje.csv (každé nasazení = řádek), přehled Aktuality /qa/aktuality.
 */
export const changelog = defineObject({
  id: "qa.changelog",
  table: "qa_changelog",
  label: "@QA:ChangelogEntry",
  labelPlural: "@QA:Changelog",
  scope: "tenant",
  fields: {
    releasedAt: { edt: Edts.TransDate, label: "@QA:ReleasedAt", mandatory: true, default: "$today", aliases: ["nasazeno", "datum"] },
    kind: { edt: enumEdt(ChangeKind), mandatory: true, default: "feature" },
    area: { edt: Text("QaChangeArea", "@QA:Area", 60), aliases: ["oblast", "modul"] },
    title: { edt: Edts.Description, label: "@QA:ChangeTitle", mandatory: true },
    body: { edt: Edts.Notes, label: "@QA:ChangeBody", help: "@QA:ChangeBodyHelp", aliases: ["popis"] },
    issueId: { edt: refEdt("qa.issue", "@QA:Issue"), aliases: ["požadavek", "pozadavek", "cr"] },
    commit: { edt: Text("QaCommit", "@QA:Commit", 40), aliases: ["commit", "verze"] },
    published: { edt: Edts.NoYes, label: "@QA:Published", default: true },
  },
  titleField: "title",
  list: ["releasedAt", "kind", "area", "title", "issueId", "commit", "published"],
  form: [
    { label: "@SYS:General", fields: ["releasedAt", "kind", "area", "title", "issueId", "commit", "published"] },
    { label: "@QA:ChangeBody", fields: ["body"] },
  ],
  unique: [["releasedAt", "title"]],
  defaultSort: { field: "releasedAt", dir: "desc" },
});

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
    /** souhrnný požadavek (např. Deníky – opravy a úpravy), pod který dílčí požadavek patří */
    parentId: { edt: refEdt("qa.issue", "@QA:Parent") },
    priority: { edt: enumEdt(Priority), mandatory: true, default: "medium" },
    status: { edt: enumEdt(IssueStatus), mandatory: true, default: "new" },
    order: { edt: Edts.Int, label: "@QA:Order" },
    /** 1 kritická … 4 nízká — pro řazení podle priority */
    priorityRank: { edt: Edts.Int, label: "@QA:Priority", readOnly: true },
    reportedBy: { edt: Text("QaReporter", "@QA:ReportedBy", 120) },
    assignedTo: { edt: Text("QaAssignee", "@QA:AssignedTo", 120) },
    dueDate: { edt: Edts.TransDate, label: "@QA:DueDate" },
    description: { edt: Edts.Notes, label: "@QA:DescriptionGroup", aliases: ["popis", "description"] },
    resolution: { edt: Edts.Notes, label: "@QA:Resolution" },
  },
  titleField: "issueNum",
  list: ["issueNum", "type", "title", "parentId", "featureId", "priority", "status", "order", "assignedTo", "dueDate"],
  form: [
    { label: "@SYS:General", fields: ["issueNum", "type", "title", "parentId", "featureId", "scenarioId", "priority", "status", "order"] },
    { label: "@QA:Responsibility", fields: ["reportedBy", "assignedTo", "dueDate"] },
    { label: "@QA:DescriptionGroup", fields: ["description", "resolution"] },
  ],
  unique: [["issueNum"]],
  numberSeq: { field: "issueNum", seq: "QAISSUE" },
  defaultSort: { field: "priorityRank", dir: "asc" },
  // detail: opravy (kontrolní seznam se stavem), dílčí požadavky, diskuze
  lines: [
    { object: "qa.issueItem", field: "issueId", label: "@QA:Items", inline: true, copy: false },
    { object: "qa.issue", field: "parentId", label: "@QA:Children", owned: false },
    { object: "qa.comment", field: "issueId", label: "@QA:Discussion", copy: false },
  ],
});

/** Oprava / kontrolní bod souhrnného požadavku: co se opravilo a jestli to tester potvrdil. */
export const issueItem = defineObject({
  id: "qa.issueItem",
  table: "qa_issue_item",
  label: "@QA:Item",
  labelPlural: "@QA:Items",
  scope: "tenant",
  fields: {
    issueId: { edt: refEdt("qa.issue", "@QA:Issue"), mandatory: true },
    lineNum: { edt: Edts.Int, label: "@QA:LineNum", readOnly: true },
    text: { edt: Edts.Description, label: "@QA:ItemText", mandatory: true },
    status: { edt: enumEdt(ItemStatus), mandatory: true, default: "todo" },
    fixedAt: { edt: Edts.TransDate, label: "@QA:FixedAt" },
    checkedAt: { edt: Edts.TransDate, label: "@QA:CheckedAt", readOnly: true },
    note: { edt: Edts.Description, label: "@QA:ItemNote" },
  },
  titleField: "text",
  list: ["lineNum", "text", "status", "fixedAt", "checkedAt", "note"],
  form: [{ label: "@SYS:General", fields: ["issueId", "text", "status", "fixedAt", "checkedAt", "note"] }],
  defaultSort: { field: "lineNum", dir: "asc" },
});

/** Příspěvek diskuze pod požadavkem (autor a čas doplní systém). */
export const comment = defineObject({
  id: "qa.comment",
  table: "qa_comment",
  label: "@QA:Comment",
  labelPlural: "@QA:Discussion",
  scope: "tenant",
  fields: {
    issueId: { edt: refEdt("qa.issue", "@QA:Issue"), mandatory: true },
    text: { edt: Edts.Notes, label: "@QA:CommentText", mandatory: true },
    author: { edt: Text("QaAuthor", "@QA:Author", 120), readOnly: true },
    postedAt: { edt: Edts.TransDate, label: "@QA:PostedAt", readOnly: true },
  },
  titleField: "author",
  list: ["postedAt", "author", "text"],
  form: [{ label: "@QA:Comment", fields: ["issueId", "text", "author", "postedAt"] }],
  defaultSort: { field: "postedAt", dir: "asc" },
});

/** Druh příspěvku zpětné vazby. */
export const FeedbackKind = defineEnum({
  id: "QaFeedbackKind",
  label: "@QA:FeedbackKind",
  values: [
    { value: "idea", label: "@QA:FbIdea", color: "brand" },
    { value: "problem", label: "@QA:FbProblem", color: "danger" },
    { value: "question", label: "@QA:FbQuestion", color: "informative" },
    { value: "praise", label: "@QA:FbPraise", color: "success" },
  ],
});
export const FeedbackStatus = defineEnum({
  id: "QaFeedbackStatus",
  label: "@QA:FeedbackStatus",
  values: [
    { value: "new", label: "@QA:New", color: "informative" },
    { value: "read", label: "@QA:FbRead" },
    { value: "planned", label: "@QA:FbPlanned", color: "brand" },
    { value: "done", label: "@QA:Done", color: "success" },
    { value: "rejected", label: "@QA:Rejected", color: "subtle" },
  ],
});

/**
 * Náměty a zpětná vazba od uživatelů: co chybí, nefunguje nebo by šlo lépe. Autor a datum se doplní samy;
 * vývoj z námětu založí požadavek (Vytvořit požadavek) a odpoví. Odkaz sem vede i z pozvánky.
 */
export const feedback = defineObject({
  id: "qa.feedback",
  table: "qa_feedback",
  label: "@QA:Feedback",
  labelPlural: "@QA:Feedbacks",
  scope: "tenant",
  fields: {
    feedbackNum: { edt: Edts.Code, label: "@QA:FeedbackNum", mandatory: true },
    kind: { edt: enumEdt(FeedbackKind), mandatory: true, default: "idea" },
    title: { edt: Edts.Description, label: "@QA:Title", mandatory: true },
    text: { edt: Edts.Notes, label: "@QA:FbText", help: "@QA:FbTextHelp" },
    featureId: { edt: refEdt("qa.feature", "@QA:Feature") },
    page: { edt: Text("QaFbPage", "@QA:FbPage", 300), help: "@QA:FbPageHelp" },
    status: { edt: enumEdt(FeedbackStatus), mandatory: true, default: "new" },
    /** kdo námět zadal (lze zadat za jiného uživatele) — dostává upozornění na odpověď */
    authorUserId: { edt: Edts.User, label: "@QA:FbAuthorUser", help: "@QA:FbAuthorUserHelp" },
    author: { edt: Text("QaFbAuthor", "@QA:Author", 120), help: "@QA:FbAuthorHelp" },
    postedAt: { edt: Edts.TransDate, label: "@QA:PostedAt", readOnly: true },
    issueId: { edt: refEdt("qa.issue", "@QA:Issue"), readOnly: true },
    reply: { edt: Edts.Notes, label: "@QA:FbReply" },
  },
  titleField: "feedbackNum",
  list: ["feedbackNum", "kind", "title", "featureId", "author", "postedAt", "status", "issueId"],
  form: [
    { label: "@SYS:General", fields: ["feedbackNum", "kind", "title", "text", "featureId", "page", "authorUserId", "author"] },
    { label: "@QA:FbHandling", fields: ["status", "postedAt", "issueId", "reply"] },
  ],
  unique: [["feedbackNum"]],
  numberSeq: { field: "feedbackNum", seq: "QAFEEDBACK" },
  defaultSort: { field: "feedbackNum", dir: "desc" },
  actions: [{ id: "createIssue", label: "@QA:FbCreateIssue", when: { field: "issueId", equals: null } }],
});

/** stav námětu → label (text upozornění zadavateli) */
const STATUS_LABEL: Record<string, string> = { new: "New", read: "FbRead", planned: "FbPlanned", done: "Done", rejected: "Rejected" };

/** Testovaný scénář dostane datum, pokud ho tester nevyplnil. */
const RANK: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
/** řešitel požadavků ve vývoji */
export const DEVELOPER = "Claude (vývoj)";

export const qaHandlers: Record<string, ObjectHandlers> = {
  "qa.issue": {
    async beforeSave(ctx, d, isNew) {
      d.priorityRank = RANK[String(d.priority)] ?? 3;
      // požadavek z námětu k vyzkoušení (UAT) / hotový → upozornění zadavateli námětu
      if (!isNew && d.id && (d.status === "uat" || d.status === "done")) {
        const before = await ctx.data.get("qa.issue", String(d.id));
        if (before && before.status !== d.status)
          for (const fb of await ctx.data.find("qa.feedback", { issueId: d.id }, { take: 20 })) {
            if (!fb.authorUserId || fb.authorUserId === ctx.userId) continue;
            await notify(ctx.data, {
              kind: "info",
              title: d.status === "uat" ? "@QA:IssueNotifyUat" : "@QA:IssueNotifyDone",
              params: { num: String(d.issueNum), fb: String(fb.feedbackNum), title: String(d.title ?? "").slice(0, 80) },
              href: `/qa/issue/${String(d.id)}`,
              userId: String(fb.authorUserId),
            });
          }
      }
      // vývoj bez řešitele = vývojář (Claude)
      // vývoj / vráceno z testu: řeší vývojář (Claude), pokud řešitel není jiný
      if ((d.status === "development" || d.status === "returned") && !d.assignedTo) d.assignedTo = DEVELOPER;
    },
  },
  "qa.issueItem": {
    async beforeSave(ctx, d, isNew) {
      if (isNew && !d.lineNum) {
        const [last] = await ctx.data.find("qa.issueItem", { issueId: d.issueId }, { take: 1, orderBy: { lineNum: "desc" } });
        d.lineNum = Number(last?.lineNum ?? 0) + 1;
      }
      const today = new Date().toISOString().slice(0, 10);
      if (d.status === "fixed" && !d.fixedAt) d.fixedAt = today;
      // potvrzení testerem (funguje / nefunguje) = datum ověření
      if (d.status === "ok" || d.status === "failing") d.checkedAt = today;
      else d.checkedAt = null;
    },
    async afterSave(ctx, d) {
      // stále nefunguje → požadavek v testu / hotový se vrací do vývoje
      if (d.status !== "failing") return;
      const iss = await ctx.data.get("qa.issue", String(d.issueId));
      if (iss && ["fat", "uat", "done"].includes(String(iss.status))) await ctx.data.update("qa.issue", String(iss.id), { status: "returned", assignedTo: iss.assignedTo || DEVELOPER });
    },
  },
  "qa.comment": {
    beforeSave(ctx, d, isNew) {
      if (isNew) {
        d.author = ctx.userName ?? null;
        d.postedAt = new Date().toISOString().slice(0, 10);
      }
    },
  },
  "qa.feedback": {
    async beforeSave(ctx, d, isNew) {
      const nameOf = (id: unknown) => ctx.users?.find((u) => u.id === id)?.name ?? null;
      const before = isNew || !d.id ? null : await ctx.data.get("qa.feedback", String(d.id));
      if (isNew) {
        // zadavatel = přihlášený, nebo vybraný uživatel (námět za někoho jiného)
        if (!d.authorUserId && !d.author) d.authorUserId = ctx.userId;
        d.postedAt = new Date().toISOString().slice(0, 10);
      }
      // jméno podle vybraného uživatele (ručně psané jméno zůstane, když se uživatel nemění)
      if (d.authorUserId && (isNew ? !d.author : before?.authorUserId !== d.authorUserId)) d.author = nameOf(d.authorUserId) ?? d.author ?? null;
      if (isNew && !d.author) d.author = ctx.userName ?? null;
      // odpověď / změna stavu → upozornění zadavateli (ne tomu, kdo odpovídá)
      if (before && d.authorUserId && d.authorUserId !== ctx.userId && (before.reply !== d.reply || before.status !== d.status)) {
        await notify(ctx.data, {
          kind: "info",
          title: d.reply && before.reply !== d.reply ? "@QA:FbNotifyReply" : "@QA:FbNotifyStatus",
          params: { num: String(d.feedbackNum), title: String(d.title ?? "").slice(0, 80), status: `@QA:${STATUS_LABEL[String(d.status)] ?? "New"}` },
          href: `/qa/feedback/${String(d.id)}`,
          userId: String(d.authorUserId),
        });
      }
    },
    // nový námět → upozornění správcům (superuživatelům), kromě toho, kdo ho zapsal
    async afterSave(ctx, d, isNew) {
      if (!isNew) return;
      for (const u of ctx.users ?? []) {
        if (u.role !== "admin" || u.id === ctx.userId) continue;
        await notify(ctx.data, {
          kind: "info",
          title: "@QA:FbNotifyNew",
          params: { num: String(d.feedbackNum), title: String(d.title ?? "").slice(0, 80), author: String(d.author ?? "") },
          href: `/qa/feedback/${String(d.id)}`,
          userId: u.id,
        });
      }
    },
    actions: {
      // námět → požadavek (problém = chyba), vazba zpět a stav Převedeno na požadavek
      async createIssue(ctx, fb) {
        const desc = [String(fb.text ?? ""), fb.page ? String(fb.page) : "", `(${String(fb.feedbackNum)}, ${String(fb.author ?? "")})`].filter(Boolean).join("\n");
        const iss = await ctx.data.create("qa.issue", {
          type: fb.kind === "problem" ? "bug" : "change",
          title: fb.title,
          featureId: fb.featureId ?? null,
          reportedBy: fb.author ?? null,
          description: desc,
        });
        await ctx.data.update("qa.feedback", String(fb.id), { issueId: iss.id, status: "planned" });
        return { open: { object: "qa.issue", id: String(iss.id) } };
      },
    },
  },
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
  enums: [FeatureStatus, TestStage, TestResult, IssueType, Priority, IssueStatus, ItemStatus, ChangeKind, FeedbackKind, FeedbackStatus],
  objects: [feature, scenario, issue, issueItem, comment, changelog, feedback],
  menu: [
    { label: "@QA:Module", items: [{ object: "qa.feedback" }, { object: "qa.issue" }, { object: "qa.scenario" }, { object: "qa.changelog" }] },
    { label: "@QA:Module", kind: "functions", items: [{ href: "/qa/aktuality", label: "@QA:News" }] },
    { label: "@SYS:Setup", items: [{ object: "qa.feature" }] },
  ],
  // řada je per firma (číselné řady patří firmě); požadavky jsou sdílené v tenantovi
  numberSeqs: [
    { code: "QAISSUE", name: "@QA:Issues", format: "CR{YY}-{####}", usedFor: "qa.issue" },
    { code: "QAFEEDBACK", name: "@QA:Feedbacks", format: "NAM{YY}-{####}", usedFor: "qa.feedback" },
  ],
  labels: {
    cs: {
      Returned: "Vráceno do vývoje",
      Feedback: "Námět",
      Feedbacks: "Náměty a zpětná vazba",
      FeedbackNum: "Číslo",
      FeedbackKind: "Druh",
      FeedbackStatus: "Stav",
      FbIdea: "Námět",
      FbProblem: "Problém",
      FbQuestion: "Dotaz",
      FbPraise: "Pochvala",
      FbRead: "Přečteno",
      FbPlanned: "Převedeno na požadavek",
      FbText: "Popis",
      FbTextHelp: "Co jste dělali, co jste čekali a co se stalo. U námětu stačí, co by vám pomohlo.",
      FbPage: "Kde (adresa stránky)",
      FbPageHelp: "Zkopírujte adresu z prohlížeče, ať víme, o kterou obrazovku jde.",
      FbHandling: "Vyřízení",
      FbReply: "Odpověď",
      FbCreateIssue: "Vytvořit požadavek",
      FbAuthorUser: "Zadavatel",
      FbAuthorUserHelp: "Kdo námět zadal – lze vybrat jiného uživatele (zapisujete za něj). Dostává upozornění na odpověď.",
      FbAuthorHelp: "Jméno zadavatele; když není uživatelem Shanonu, napište ho sem.",
      FbNotifyNew: "Nový námět {num}: {title} ({author})",
      FbNotifyReply: "Odpověď na váš námět {num}: {title}",
      FbNotifyStatus: "Námět {num} ({title}): {status}",
      IssueNotifyUat: "K vyzkoušení: {title} (požadavek {num} z vašeho námětu {fb})",
      IssueNotifyDone: "Hotovo: {title} (požadavek {num} z vašeho námětu {fb})",
      Module: "Testování a vývoj",
      ChangelogEntry: "Záznam deníku vývoje",
      Changelog: "Deník vývoje",
      News: "Aktuality",
      NewsDesc: "Co je nového v aplikaci: nasazené funkce, změny a opravy.",
      NewsSearch: "Hledat v aktualitách",
      NewsAll: "Vše",
      NewsEmpty: "Nic nenalezeno.",
      ChangeKind: "Druh",
      KindFeature: "Nová funkce",
      KindChange: "Změna",
      KindFix: "Oprava",
      ReleasedAt: "Nasazeno na PROD",
      ChangeTitle: "Stručně",
      ChangeBody: "Popis a použití",
      ChangeBodyHelp: "O co jde a jak se to používá. Odstavce oddělte prázdným řádkem, odrážka začíná „- “.",
      Commit: "Verze / commit",
      Published: "Zobrazit v Aktualitách",
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
      Comment: "Příspěvek",
      Discussion: "Diskuze",
      Parent: "Souhrnný požadavek",
      Children: "Dílčí požadavky",
      Items: "Opravy",
      Item: "Oprava",
      ItemText: "Co se opravuje",
      ItemStatus: "Stav opravy",
      ItemTodo: "Čeká",
      ItemFixed: "Opraveno – k ověření",
      ItemOk: "Funguje",
      ItemFailing: "Stále nefunguje",
      FixedAt: "Opraveno dne",
      CheckedAt: "Ověřeno dne",
      ItemNote: "Poznámka",
      LineNum: "Pořadí",
      CommentText: "Text",
      Author: "Autor",
      PostedAt: "Datum",
    },
    en: {
      Feedback: "Suggestion",
      Feedbacks: "Suggestions and feedback",
      FeedbackNum: "Number",
      FeedbackKind: "Kind",
      FeedbackStatus: "Status",
      FbIdea: "Suggestion",
      FbProblem: "Problem",
      FbQuestion: "Question",
      FbPraise: "Praise",
      FbRead: "Read",
      FbPlanned: "Turned into a request",
      FbText: "Description",
      FbTextHelp: "What you did, what you expected and what happened. For a suggestion, what would help you.",
      FbPage: "Where (page address)",
      FbPageHelp: "Copy the address from the browser so we know which screen it is about.",
      FbHandling: "Handling",
      FbReply: "Reply",
      FbCreateIssue: "Create request",
      FbAuthorUser: "Submitted by",
      FbAuthorUserHelp: "Who submitted the suggestion – you can pick another user (entering it on their behalf). They get notified about the reply.",
      FbAuthorHelp: "Submitter name; if they are not a Shanon user, type it here.",
      FbNotifyNew: "New suggestion {num}: {title} ({author})",
      FbNotifyReply: "Reply to your suggestion {num}: {title}",
      FbNotifyStatus: "Suggestion {num} ({title}): {status}",
      IssueNotifyUat: "Ready to test: {title} (request {num} from your suggestion {fb})",
      IssueNotifyDone: "Done: {title} (request {num} from your suggestion {fb})",
      Returned: "Returned to development",
      Module: "Testing and development",
      ChangelogEntry: "Development log entry",
      Changelog: "Development log",
      News: "What's new",
      NewsDesc: "What's new in the app: released features, changes and fixes.",
      NewsSearch: "Search the news",
      NewsAll: "All",
      NewsEmpty: "Nothing found.",
      ChangeKind: "Kind",
      KindFeature: "New feature",
      KindChange: "Change",
      KindFix: "Fix",
      ReleasedAt: "Released to PROD",
      ChangeTitle: "Summary",
      ChangeBody: "Description and usage",
      ChangeBodyHelp: "What it is and how to use it. Separate paragraphs with an empty line, bullets start with „- “.",
      Commit: "Version / commit",
      Published: "Show in What's new",
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
      Comment: "Comment",
      Discussion: "Discussion",
      Parent: "Parent request",
      Children: "Sub-requests",
      Items: "Fixes",
      Item: "Fix",
      ItemText: "What is fixed",
      ItemStatus: "Fix status",
      ItemTodo: "Pending",
      ItemFixed: "Fixed – to verify",
      ItemOk: "Works",
      ItemFailing: "Still failing",
      FixedAt: "Fixed on",
      CheckedAt: "Verified on",
      ItemNote: "Note",
      LineNum: "Order",
      CommentText: "Text",
      Author: "Author",
      PostedAt: "Date",
    },
  },
});
