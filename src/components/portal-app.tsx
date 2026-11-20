"use client";
/**
 * Aplikace Portál (mobil i počítač): přihlášení zaměstnance (osobní číslo + heslo) a dodavatele (odkaz do
 * e-mailu), nastavení hesla z pozvánky, výběr firmy a agendy, fotka / soubor s úpravou, poznámka, odeslání.
 * Poslední firma a agenda se nabídnou příště (server u přihlášeného + prohlížeč).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Dropdown,
  Field,
  Input,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { Camera24Regular, Delete24Regular, DocumentArrowUp24Regular, Edit24Regular, SignOut24Regular } from "@fluentui/react-icons";
import { portalAgendasAction, portalEmployeeLoginAction, portalLogoutAction, portalRememberAgendaAction, portalSetPasswordAction, portalVendorLinkAction } from "@/app/p/actions";
import type { PortalLabels } from "@/app/p/[tenant]/labels";
import { InstallAppButton } from "./install-app";
import { PhotoEditor } from "./photo-editor";

const useStyles = makeStyles({
  page: { minHeight: "100dvh", backgroundColor: tokens.colorNeutralBackground2, display: "flex", flexDirection: "column" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  logo: { height: "28px", backgroundColor: "#fff", borderRadius: tokens.borderRadiusMedium, padding: "2px 6px" },
  grow: { flexGrow: 1, minWidth: 0 },
  main: { width: "100%", maxWidth: "640px", margin: "0 auto", padding: tokens.spacingHorizontalL, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  agendas: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: tokens.spacingHorizontalS },
  agenda: { cursor: "pointer", minHeight: "72px" },
  agendaOn: { outline: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  row: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS, alignItems: "center" },
  file: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, padding: tokens.spacingVerticalXS, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  thumb: { width: "56px", height: "56px", objectFit: "cover", borderRadius: tokens.borderRadiusSmall, backgroundColor: tokens.colorNeutralBackground3 },
  big: { minHeight: "48px", fontSize: tokens.fontSizeBase400 },
  hidden: { display: "none" },
});

function Shell({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.page}>
      <header className={s.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-header.png" alt="Shanon" className={s.logo} />
        <Text weight="semibold" size={400} className={s.grow} truncate wrap={false}>
          {title}
        </Text>
        {right}
      </header>
      <main className={s.main}>{children}</main>
    </div>
  );
}

export function PortalNoTenant({ title, text }: { title: string; text: string }) {
  return (
    <Shell title={title}>
      <MessageBar>
        <MessageBarBody>{text}</MessageBarBody>
      </MessageBar>
    </Shell>
  );
}

export function PortalLogin({ tenant, orgName, L, linkInvalid, initialTab }: { tenant: string; orgName: string; L: PortalLabels; linkInvalid?: boolean; initialTab: "employee" | "vendor" }) {
  const s = useStyles();
  const router = useRouter();
  const [tab, setTab] = useState<"employee" | "vendor">(initialTab);
  const [num, setNum] = useState("");
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ intent: "error" | "success"; text: string } | null>(linkInvalid ? { intent: "error", text: L.AppLinkInvalid } : null);

  const go = async (fn: () => Promise<{ ok: boolean; message?: string }>, okText?: string) => {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setMsg({ intent: "error", text: r.message ?? L.AppError });
    else if (okText) setMsg({ intent: "success", text: okText });
    else router.refresh();
  };

  return (
    <Shell title={`${L.AppTitle} · ${orgName}`} right={<InstallAppButton label={L.AppInstall} iosText={L.AppInstallIos} installedText={L.AppInstalled} appearance="subtle" iconOnly />}>
      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => {
          setTab(d.value as "employee" | "vendor");
          // poslední záložka (zaměstnanec / dodavatel) se nabídne příště — čte ji server
          document.cookie = `shanon_portal_tab=${String(d.value)}; path=/p/; max-age=31536000; samesite=lax`;
          setMsg(null);
        }}
      >
        <Tab value="employee">{L.AppEmployee}</Tab>
        <Tab value="vendor">{L.AppVendor}</Tab>
      </TabList>
      {msg && (
        <MessageBar intent={msg.intent}>
          <MessageBarBody>{msg.text}</MessageBarBody>
        </MessageBar>
      )}
      {tab === "employee" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void go(() => portalEmployeeLoginAction(tenant, num, pw));
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Text>{L.AppEmployeeHint}</Text>
          <Field label={L.AppPersonalNum} required>
            <Input value={num} onChange={(_, d) => setNum(d.value)} autoComplete="username" autoCapitalize="characters" className={s.big} />
          </Field>
          <Field label={L.AppPassword} required>
            <Input type="password" value={pw} onChange={(_, d) => setPw(d.value)} autoComplete="current-password" className={s.big} />
          </Field>
          <Button appearance="primary" type="submit" disabled={busy || !num || !pw} className={s.big}>
            {busy ? <Spinner size="tiny" /> : L.AppSignIn}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void go(() => portalVendorLinkAction(tenant, email), L.AppLinkSent);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Text>{L.AppVendorHint}</Text>
          <Field label={L.AppEmail} required>
            <Input type="email" value={email} onChange={(_, d) => setEmail(d.value)} autoComplete="email" inputMode="email" className={s.big} />
          </Field>
          <Button appearance="primary" type="submit" disabled={busy || !email} className={s.big}>
            {busy ? <Spinner size="tiny" /> : L.AppSendLink}
          </Button>
        </form>
      )}
    </Shell>
  );
}

export function PortalSetPassword({ tenant, token, login, minLength, L }: { tenant: string; token: string; login: string | null; minLength: number; L: PortalLabels }) {
  const s = useStyles();
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!login)
    return (
      <Shell title={L.AppSetPassword}>
        <MessageBar intent="error">
          <MessageBarBody>{L.AppLinkExpired}</MessageBarBody>
        </MessageBar>
      </Shell>
    );
  return (
    <Shell title={L.AppSetPassword}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setErr(L.AppPasswordMismatch);
          setBusy(true);
          const r = await portalSetPasswordAction(tenant, token, pw);
          setBusy(false);
          if (!r.ok) return setErr(r.message);
          router.replace(`/p/${tenant}`);
        }}
      >
        <Field label={L.AppPersonalNum}>
          <Input value={login} readOnly autoComplete="username" className={s.big} />
        </Field>
        <Field label={L.AppNewPassword} required hint={L.AppPasswordShortHint.replace("{min}", String(minLength))}>
          <Input type="password" value={pw} minLength={minLength} onChange={(_, d) => setPw(d.value)} autoComplete="new-password" className={s.big} />
        </Field>
        <Field label={L.AppRepeatPassword} required>
          <Input type="password" value={pw2} onChange={(_, d) => setPw2(d.value)} autoComplete="new-password" className={s.big} />
        </Field>
        {err && (
          <MessageBar intent="error">
            <MessageBarBody>{err}</MessageBarBody>
          </MessageBar>
        )}
        <Button appearance="primary" type="submit" disabled={busy || pw.length < minLength} className={s.big}>
          {busy ? <Spinner size="tiny" /> : L.AppSave}
        </Button>
      </form>
    </Shell>
  );
}

type Agenda = { id: string; label: string; hint: string };
type Picked = { id: number; file: File; url: string | null };

export function PortalApp(p: {
  tenant: string;
  kind: "employee" | "vendor";
  name: string;
  login: string;
  companies: { id: string; name: string }[];
  companyId: string;
  agendas: Agenda[];
  limits: { maxFileMb: number; maxFiles: number };
  lastAgenda: string | null;
  L: PortalLabels;
}) {
  const s = useStyles();
  const router = useRouter();
  const L = p.L;
  const [companyId, setCompanyId] = useState(p.companyId);
  const [agendas, setAgendas] = useState(p.agendas);
  const [limits, setLimits] = useState(p.limits);
  const firstAgenda = (list: Agenda[], last: string | null) => (last && list.some((x) => x.id === last) ? last : list.length === 1 ? list[0].id : null);
  // poslední agenda (uložená u přihlášeného) — jen když je pořád k dispozici
  const [agenda, setAgenda] = useState<string | null>(() => firstAgenda(p.agendas, p.lastAgenda));
  const [files, setFiles] = useState<Picked[]>([]);
  const [editing, setEditing] = useState<Picked | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ intent: "error" | "success"; text: string } | null>(null);
  const [sent, setSent] = useState<string[] | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const pickAgenda = (id: string) => {
    setAgenda(id);
    void portalRememberAgendaAction(p.tenant, companyId, id);
  };

  const addFiles = (list: FileList | null, fromCamera: boolean) => {
    if (!list?.length) return;
    const add = [...list].slice(0, Math.max(0, limits.maxFiles - files.length)).map((f) => ({ id: ++seq.current, file: f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null }));
    setFiles((x) => [...x, ...add]);
    // fotka z fotoaparátu: rovnou úprava (oříznutí, narovnání)
    if (fromCamera && add[0]?.url) setEditing(add[0]);
  };

  const send = async () => {
    if (!agenda || !files.length) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("agenda", agenda);
    fd.set("note", note);
    for (const f of files) fd.append("files", f.file, f.file.name);
    try {
      const r = await fetch(`/api/p/${p.tenant}/submit`, { method: "POST", body: fd });
      const j = (await r.json()) as { ok: boolean; error?: string; files: { name: string; ok: boolean; docNum?: string; error?: string }[] };
      if (r.status === 401) return router.refresh();
      const bad = j.files.filter((f) => !f.ok);
      if (!j.ok) setMsg({ intent: "error", text: j.error ?? L.AppError });
      else {
        setSent(j.files.filter((f) => f.ok).map((f) => f.docNum ?? f.name));
        files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
        setFiles([]);
        setNote("");
        if (bad.length) setMsg({ intent: "error", text: bad.map((b) => `${b.name}: ${b.error}`).join(" · ") });
      }
    } catch {
      setMsg({ intent: "error", text: L.AppError });
    } finally {
      setBusy(false);
    }
  };

  const changeCompany = async (id: string) => {
    setCompanyId(id);
    setMsg(null);
    const r = await portalAgendasAction(p.tenant, id);
    if (!r.ok) return setMsg({ intent: "error", text: r.message });
    setAgendas(r.data.agendas);
    setAgenda((a) => firstAgenda(r.data.agendas, a));
    setLimits({ maxFileMb: r.data.maxFileMb, maxFiles: r.data.maxFiles });
  };

  const header = (
    <div className={s.row}>
      <InstallAppButton label={L.AppInstall} iosText={L.AppInstallIos} installedText={L.AppInstalled} appearance="subtle" iconOnly />
      <Button
        appearance="subtle"
        icon={<SignOut24Regular />}
        aria-label={L.AppSignOut}
        title={L.AppSignOut}
        style={{ color: "inherit" }}
        onClick={async () => {
          await portalLogoutAction();
          router.refresh();
        }}
      />
    </div>
  );

  if (editing)
    return (
      <Shell title={L.AppEditPhoto} right={header}>
        <PhotoEditor
          file={editing.file}
          L={{ rotate: L.AppRotate, enhance: L.AppEnhance, done: L.AppDone, cancel: L.AppRemove, reset: L.AppReset, hint: L.AppCornersHint }}
          onCancel={() => {
            setFiles((x) => x.filter((f) => f.id !== editing.id));
            setEditing(null);
          }}
          onDone={(f) => {
            const url = URL.createObjectURL(f);
            setFiles((x) => x.map((y) => (y.id === editing.id ? (y.url && URL.revokeObjectURL(y.url), { ...y, file: f, url }) : y)));
            setEditing(null);
          }}
        />
      </Shell>
    );

  const company = p.companies.find((c) => c.id === companyId);
  return (
    <Shell title={L.AppTitle} right={header}>
      <Text>{L.AppHello.replace("{name}", p.name)}</Text>
      {p.companies.length > 1 ? (
        <Field label={L.AppCompany}>
          <Dropdown value={company?.name ?? ""} selectedOptions={[companyId]} onOptionSelect={(_, d) => d.optionValue && void changeCompany(d.optionValue)}>
            {p.companies.map((c) => (
              <Option key={c.id} value={c.id}>
                {c.name}
              </Option>
            ))}
          </Dropdown>
        </Field>
      ) : (
        <Text weight="semibold">{company?.name}</Text>
      )}

      {sent ? (
        <>
          <MessageBar intent="success">
            <MessageBarBody>
              {L.AppSent} {sent.length ? `${L.AppSentDoc} ${sent.join(", ")}` : ""}
            </MessageBarBody>
          </MessageBar>
          {msg && (
            <MessageBar intent={msg.intent}>
              <MessageBarBody>{msg.text}</MessageBarBody>
            </MessageBar>
          )}
          <Button appearance="primary" className={s.big} onClick={() => (setSent(null), setMsg(null))}>
            {L.AppAnother}
          </Button>
        </>
      ) : !agendas.length ? (
        <MessageBar>
          <MessageBarBody>{L.AppNoAgenda}</MessageBarBody>
        </MessageBar>
      ) : (
        <>
          <Field label={L.AppAgenda}>
            <div className={s.agendas} role="radiogroup">
              {agendas.map((a) => (
                <Card key={a.id} role="radio" aria-checked={agenda === a.id} tabIndex={0} className={`${s.agenda} ${agenda === a.id ? s.agendaOn : ""}`} onClick={() => pickAgenda(a.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pickAgenda(a.id)}>
                  <Text weight="semibold">{a.label}</Text>
                  <Text size={200}>{a.hint}</Text>
                </Card>
              ))}
            </div>
          </Field>

          {agenda && (
            <>
              <div className={s.row}>
                <Button appearance="primary" icon={<Camera24Regular />} className={s.big} disabled={files.length >= limits.maxFiles} onClick={() => camera.current?.click()}>
                  {L.AppTakePhoto}
                </Button>
                <Button icon={<DocumentArrowUp24Regular />} className={s.big} disabled={files.length >= limits.maxFiles} onClick={() => picker.current?.click()}>
                  {L.AppChooseFile}
                </Button>
                <input ref={camera} className={s.hidden} type="file" accept="image/*" capture="environment" onChange={(e) => (addFiles(e.target.files, true), (e.target.value = ""))} />
                <input ref={picker} className={s.hidden} type="file" multiple accept=".pdf,.isdoc,.isdocx,.xml,image/png,image/jpeg,image/webp" onChange={(e) => (addFiles(e.target.files, false), (e.target.value = ""))} />
              </div>
              {files.length > 0 && (
                <div>
                  <Text size={200}>{L.AppFiles.replace("{n}", String(files.length)).replace("{max}", String(limits.maxFiles))}</Text>
                  {files.map((f) => (
                    <div key={f.id} className={s.file}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {f.url ? <img src={f.url} alt="" className={s.thumb} /> : <DocumentArrowUp24Regular />}
                      <Text className={s.grow} truncate wrap={false}>
                        {f.file.name} · {(f.file.size / 1024 / 1024).toFixed(1)} MB
                      </Text>
                      {f.url && <Button appearance="subtle" icon={<Edit24Regular />} aria-label={L.AppEditPhoto} onClick={() => setEditing(f)} />}
                      <Button
                        appearance="subtle"
                        icon={<Delete24Regular />}
                        aria-label={L.AppRemove}
                        onClick={() => setFiles((x) => (f.url && URL.revokeObjectURL(f.url), x.filter((y) => y.id !== f.id)))}
                      />
                    </div>
                  ))}
                </div>
              )}
              <Field label={L.AppNote}>
                <Textarea value={note} onChange={(_, d) => setNote(d.value)} maxLength={255} placeholder={L.AppNotePlaceholder} resize="vertical" />
              </Field>
              {msg && (
                <MessageBar intent={msg.intent}>
                  <MessageBarBody>{msg.text}</MessageBarBody>
                </MessageBar>
              )}
              <Button appearance="primary" size="large" className={s.big} disabled={busy || !files.length} onClick={send}>
                {busy ? (
                  <>
                    <Spinner size="tiny" /> {L.AppSending}
                  </>
                ) : (
                  L.AppSend
                )}
              </Button>
            </>
          )}
        </>
      )}
    </Shell>
  );
}
