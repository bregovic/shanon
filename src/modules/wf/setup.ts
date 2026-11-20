/**
 * Výchozí nastavení Workflow pro firmu: typy účastníků (Vlastník, Účetní) a dvě workflow —
 * zpracování dokladů z integrace (vytěžený jistý doklad → založit partnera a zalistovat, jinak úkol
 * původci / vlastníkovi) a schválení přijaté faktury vlastníkem s automatickým zaúčtováním.
 * Zakládá jen firmě, která ještě nic nemá (úpravy a smazání tenanta zůstanou).
 */
import type { DataApi } from "@/core/module";

export const DEFAULT_PARTICIPANTS: [string, string][] = [
  ["OWNER", "Vlastník"],
  ["ACCOUNTANT", "Účetní"],
];

export async function wfSetup(data: DataApi) {
  if (!(await data.find("wf.participantType", {}, { take: 1 })).length)
    for (const [code, name] of DEFAULT_PARTICIPANTS) await data.create("wf.participantType", { code, name });
  const existing = await data.find("wf.definition", {}, { take: 1 });
  if (existing.length) {
    // doplnění z 20. 11. 2026: zamítnutí úkolu dokladu z integrace doklad odmítne (jen dosud neupravené výchozí workflow)
    const [doc] = await data.find("wf.definition", { code: "WF-DOKLADY", objectId: "int.document", rejectAction: null }, { take: 1 });
    if (doc && Number(doc.version) === 1) await data.update("wf.definition", String(doc.id), { rejectAction: "reject" });
    return;
  }
  const pt = async (code: string) => ((await data.find("wf.participantType", { code }, { take: 1 }))[0]?.id as string) ?? null;
  const owner = await pt("OWNER");
  const accountant = await pt("ACCOUNTANT");

  const doc = await data.create("wf.definition", {
    code: "WF-DOKLADY",
    name: "Zpracování dokladů z integrace",
    objectId: "int.document",
    trigger: "event",
    triggerName: "extracted",
    rejectAction: "reject",
    active: true,
    description: "Jistě vytěžený doklad (ISDOC nebo vytěžení bez výhrad): založí dodavatele / odběratele z ARES a zalistuje doklad. Chybí-li údaj nebo je nejistý, dostane úkol původce dokladu, jinak vlastník. Zamítnutím úkolu se doklad odmítne.",
  });
  await data.create("wf.definitionStep", {
    definitionId: doc.id,
    lineNum: 10,
    name: "Založit partnera a zalistovat",
    kind: "auto",
    action: "list",
    checkAction: "check",
    precondition: "status: ready; source: !portal",
    assignTo: "originator",
    participantTypeId: owner,
  });

  const inv = await data.create("wf.definition", {
    code: "WF-PRIJATE",
    name: "Schválení přijaté faktury",
    objectId: "ap.invoice",
    trigger: "created",
    lockActions: "post",
    active: true,
    description: "Vlastník firmy zkontroluje a schválí přijatou fakturu, po schválení se zaúčtuje sama. Zamítnutá zůstane v konceptu.",
  });
  await data.create("wf.definitionStep", { definitionId: inv.id, lineNum: 10, name: "Kontrola a schválení", kind: "approval", assignTo: "participant", participantTypeId: owner, dueDays: 3 });
  await data.create("wf.definitionStep", { definitionId: inv.id, lineNum: 20, name: "Zaúčtovat", kind: "auto", action: "post", assignTo: "participant", participantTypeId: accountant });
}
