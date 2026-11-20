/**
 * Šablony systémových e-mailů: jedno rozvržení (logo, nadpis, text, tlačítko, bloky údajů, patička),
 * HTML s vloženými styly (poštovní programy neznají <style> ani CSS proměnné) + textová verze.
 * Texty jsou labely (`@SYS:Mail…`) v jazyce příjemce.
 */
import type { LabelRef } from "@/core/labels";
import { envUrls } from "./system-mail";

type T = (l: LabelRef, p?: Record<string, string>) => string;

interface Block {
  heading: string;
  /** řádky „popisek: hodnota“ (hodnota může být odkaz) */
  rows?: { label: string; value: string; href?: string; note?: string }[];
  text?: string;
  link?: { label: string; href: string };
}

interface Layout {
  subject: string;
  title: string;
  intro: string[];
  button?: { label: string; href: string; note?: string };
  blocks: Block[];
  footer: string;
}

// barvy loga Shanonu (modrá), bez proměnných — e-mail je mimo aplikaci
const C = { brand: "#1f4e79", text: "#1f2328", muted: "#5f6b76", line: "#e3e8ee", bg: "#f4f6f8", box: "#f8fafc" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function render(l: Layout): { subject: string; html: string; text: string } {
  const { prod } = envUrls();
  const a = (href: string, label: string) => `<a href="${esc(href)}" style="color:${C.brand};text-decoration:underline">${esc(label)}</a>`;
  const blocks = l.blocks
    .map(
      (b) => `
      <tr><td style="padding:18px 32px 0">
        <div style="font-size:13px;font-weight:700;letter-spacing:.02em;text-transform:none;color:${C.brand};margin:0 0 8px">${esc(b.heading)}</div>
        <div style="background:${C.box};border:1px solid ${C.line};border-radius:6px;padding:12px 14px;font-size:14px;line-height:1.55;color:${C.text}">
          ${(b.rows ?? [])
            .map(
              (r) =>
                `<div style="margin:2px 0"><span style="color:${C.muted}">${esc(r.label)}:</span> ${r.href ? a(r.href, r.value) : `<b>${esc(r.value)}</b>`}${r.note ? `<div style="color:${C.muted};font-size:12px;margin:0 0 6px">${esc(r.note)}</div>` : ""}</div>`,
            )
            .join("")}
          ${b.text ? `<div>${esc(b.text)}</div>` : ""}
          ${b.link ? `<div style="margin-top:6px">${a(b.link.href, b.link.label)}</div>` : ""}
        </div>
      </td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(l.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:10px;overflow:hidden">
    <tr><td style="background:${C.brand};height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:24px 32px 0"><img src="${esc(prod)}/logo.png" alt="Shanon" height="36" style="display:block;height:36px;border:0"></td></tr>
    <tr><td style="padding:16px 32px 0;font-size:22px;font-weight:700;color:${C.text}">${esc(l.title)}</td></tr>
    <tr><td style="padding:10px 32px 0;font-size:15px;line-height:1.6;color:${C.text}">${l.intro.map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join("")}</td></tr>
    ${
      l.button
        ? `<tr><td style="padding:8px 32px 0"><a href="${esc(l.button.href)}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:6px">${esc(l.button.label)}</a>${
            l.button.note ? `<div style="font-size:12px;color:${C.muted};margin-top:8px">${esc(l.button.note)}</div>` : ""
          }</td></tr>`
        : ""
    }
    ${blocks}
    <tr><td style="padding:24px 32px 26px;font-size:12px;line-height:1.5;color:${C.muted}">${esc(l.footer)}</td></tr>
  </table>
</td></tr></table></body></html>`;
  const text = [
    l.title,
    "",
    ...l.intro,
    ...(l.button ? ["", `${l.button.label}: ${l.button.href}`, ...(l.button.note ? [l.button.note] : [])] : []),
    ...l.blocks.flatMap((b) => ["", b.heading.toUpperCase(), ...(b.rows ?? []).map((r) => `${r.label}: ${r.href ?? r.value}${r.note ? ` (${r.note})` : ""}`), ...(b.text ? [b.text] : []), ...(b.link ? [`${b.link.label}: ${b.link.href}`] : [])]),
    "",
    l.footer,
  ].join("\n");
  return { subject: l.subject, html, text };
}

/** společné bloky: prostředí, nápověda, zpětná vazba */
function commonBlocks(t: T, email: string): Block[] {
  const { prod, test, self } = envUrls();
  return [
    {
      heading: t("@SYS:MailLoginHeading"),
      rows: [
        { label: t("@SYS:MailLoginName"), value: email },
        { label: t("@SYS:MailEnvProd"), value: prod.replace(/^https?:\/\//, ""), href: prod, note: t("@SYS:MailEnvProdNote") },
        ...(test ? [{ label: t("@SYS:MailEnvTest"), value: test.replace(/^https?:\/\//, ""), href: test, note: t("@SYS:MailEnvTestNote") }] : []),
      ],
    },
    { heading: t("@SYS:MailHelpHeading"), text: t("@SYS:MailHelpText"), link: { label: t("@SYS:MailHelpCourse"), href: `${self}/help/ovladani` } },
    { heading: t("@SYS:MailFeedbackHeading"), text: t("@SYS:MailFeedbackText"), link: { label: t("@SYS:MailFeedbackLink"), href: `${self}/qa/feedback` } },
  ];
}

/** nejvýš tolik dalších firem se v pozvánce vyjmenuje; víc = jen počet */
const OTHERS_LISTED = 4;

export function inviteMail(t: T, p: { name: string; email: string; company: string; others?: string[]; inviter: string; link: string; days: number }) {
  const others = p.others ?? [];
  const more =
    others.length === 0
      ? []
      : others.length <= OTHERS_LISTED
        ? // tečka za větou, jen když ji nemá už název firmy („s.r.o.“)
          [`${t("@SYS:MailInviteOthers", { list: others.join(", ") })}${others[others.length - 1].endsWith(".") ? "" : "."}`]
        : [t("@SYS:MailInviteOthersCount", { n: String(others.length) })];
  return render({
    subject: t("@SYS:MailInviteSubject", { company: p.company }),
    title: t("@SYS:MailInviteTitle"),
    intro: [t("@SYS:MailHello", { name: p.name }), t("@SYS:MailInviteText", { company: p.company, inviter: p.inviter }), ...more],
    button: { label: t("@SYS:MailSetPassword"), href: p.link, note: t("@SYS:MailLinkValid", { days: String(p.days) }) },
    blocks: commonBlocks(t, p.email),
    footer: t("@SYS:MailFooter", { inviter: p.inviter }),
  });
}

export function resetMail(t: T, p: { name: string; email: string; inviter: string; link: string; days: number }) {
  return render({
    subject: t("@SYS:MailResetSubject"),
    title: t("@SYS:MailResetTitle"),
    intro: [t("@SYS:MailHello", { name: p.name }), t("@SYS:MailResetText", { inviter: p.inviter })],
    button: { label: t("@SYS:MailSetPassword"), href: p.link, note: t("@SYS:MailLinkValid", { days: String(p.days) }) },
    blocks: commonBlocks(t, p.email).slice(0, 1),
    footer: t("@SYS:MailResetFooter"),
  });
}

/** Žádost „Nemůžu se přihlásit“ správci: kdo, odkud a v jakém stavu je účet. */
export function loginHelpMail(t: T, p: { email: string; message: string; account: string; when: string }) {
  const { self } = envUrls();
  return render({
    subject: t("@SYS:MailHelpReqSubject", { email: p.email }),
    title: t("@SYS:MailHelpReqTitle"),
    intro: [t("@SYS:MailHelpReqText", { email: p.email })],
    button: { label: t("@SYS:MailHelpReqOpen"), href: `${self}/system/users` },
    blocks: [
      {
        heading: t("@SYS:MailHelpReqDetail"),
        rows: [
          { label: t("@SYS:Email"), value: p.email },
          { label: t("@SYS:MailHelpReqAccount"), value: p.account },
          { label: t("@SYS:MailHelpReqEnv"), value: self.replace(/^https?:\/\//, ""), href: self },
          { label: t("@SYS:MailHelpReqWhen"), value: p.when },
        ],
        text: p.message || undefined,
      },
    ],
    footer: t("@SYS:MailHelpReqFooter"),
  });
}

/**
 * Pozvánka do aplikace Portál. Zaměstnanec: nastavení hesla (přihlašuje se osobním číslem);
 * dodavatel: odkaz rovnou přihlásí, příště stačí zadat e-mail a přijde nový odkaz.
 */
export function portalInviteMail(t: T, p: { kind: "employee" | "vendor"; name: string; login: string; link: string; days: number; companies: string[]; inviter: string; appUrl: string }) {
  const emp = p.kind === "employee";
  return render({
    subject: t("@INT:MailPortalInviteSubject", { company: p.companies[0] ?? "" }),
    title: t(emp ? "@INT:MailPortalInviteTitleEmp" : "@INT:MailPortalInviteTitleVendor"),
    intro: [
      p.name ? t("@SYS:MailHello", { name: p.name }) : t("@INT:MailPortalHelloAnon"),
      t(emp ? "@INT:MailPortalInviteTextEmp" : "@INT:MailPortalInviteTextVendor", { companies: p.companies.join(", ") }),
    ],
    button: { label: t(emp ? "@INT:MailPortalSetPassword" : "@INT:MailPortalOpen"), href: p.link, note: t("@SYS:MailLinkValid", { days: String(p.days) }) },
    blocks: [
      {
        heading: t("@INT:MailPortalHowHeading"),
        rows: [
          { label: t("@INT:MailPortalAddress"), value: p.appUrl.replace(/^https?:\/\//, ""), href: p.appUrl },
          { label: t(emp ? "@INT:MailPortalLoginEmp" : "@INT:MailPortalLoginVendor"), value: p.login },
        ],
        text: t(emp ? "@INT:MailPortalHowEmp" : "@INT:MailPortalHowVendor"),
      },
      { heading: t("@INT:MailPortalInstallHeading"), text: t("@INT:MailPortalInstallText") },
    ],
    footer: p.inviter ? t("@SYS:MailFooter", { inviter: p.inviter }) : t("@INT:MailPortalFooter"),
  });
}

/** Přihlašovací odkaz dodavatele (platí krátce, jednou). */
export function portalLinkMail(t: T, p: { link: string; minutes: number; companies: string[] }) {
  return render({
    subject: t("@INT:MailPortalLinkSubject"),
    title: t("@INT:MailPortalLinkTitle"),
    intro: [t("@INT:MailPortalLinkText", { companies: p.companies.join(", ") })],
    button: { label: t("@INT:MailPortalOpen"), href: p.link, note: t("@INT:MailPortalLinkValid", { minutes: String(p.minutes) }) },
    blocks: [],
    footer: t("@INT:MailPortalLinkFooter"),
  });
}
