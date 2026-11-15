"use client";

/**
 * Dodavatelský portál — stránka pro dodavatele: co posílá (druh dokladu), kdo posílá (IČO, název),
 * soubory přetažením. Bez přihlášení; kontroly a limity hlídá server.
 */
import { useRef, useState } from "react";
import { Button, Field, Input, makeStyles, Spinner, Text, Textarea, tokens } from "@fluentui/react-components";
import {
  Cart24Regular,
  CheckmarkCircle48Filled,
  CloudArrowUp48Regular,
  Dismiss16Regular,
  Document24Regular,
  DocumentPdf24Regular,
  Money24Regular,
  Receipt24Regular,
  ShieldCheckmark16Regular,
} from "@fluentui/react-icons";
import type { PortalInfo, PortalKind, PortalResult } from "@/server/supplier-portal";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    background: `linear-gradient(160deg, ${tokens.colorBrandBackground} 0%, ${tokens.colorBrandBackgroundPressed} 38%, ${tokens.colorNeutralBackground2} 38.1%)`,
    padding: "40px 16px 60px",
    display: "flex",
    justifyContent: "center",
  },
  wrap: { width: "100%", maxWidth: "680px", display: "flex", flexDirection: "column", gap: "18px" },
  hero: { color: tokens.colorNeutralForegroundOnBrand, display: "flex", flexDirection: "column", gap: "6px", padding: "0 4px" },
  company: { fontSize: tokens.fontSizeBase300, opacity: 0.85, letterSpacing: "0.04em", textTransform: "uppercase" },
  title: { fontSize: "32px", lineHeight: "40px", fontWeight: tokens.fontWeightSemibold },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: "16px",
    boxShadow: tokens.shadow28,
    padding: "28px 28px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "22px",
  },
  step: { display: "flex", flexDirection: "column", gap: "10px" },
  stepHead: { display: "flex", alignItems: "center", gap: "10px", fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  num: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: tokens.fontSizeBase200,
  },
  kinds: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" },
  kind: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "6px",
    padding: "14px",
    borderRadius: "12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    textAlign: "left",
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    transitionProperty: "border-color, box-shadow, background-color",
    transitionDuration: "120ms",
    ":hover": { border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  kindOn: { border: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2, boxShadow: tokens.shadow4 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" },
  drop: {
    border: `2px dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: "14px",
    padding: "28px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: "center",
  },
  dropOn: { border: `2px dashed ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  files: { display: "flex", flexDirection: "column", gap: "6px" },
  file: { display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "10px", backgroundColor: tokens.colorNeutralBackground2 },
  muted: { color: tokens.colorNeutralForeground3 },
  error: { color: tokens.colorPaletteRedForeground1 },
  foot: { display: "flex", alignItems: "center", gap: "6px", color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, justifyContent: "center" },
  done: { display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center", padding: "12px 0" },
  ok: { color: tokens.colorPaletteGreenForeground1 },
  honey: { position: "absolute", left: "-10000px", width: "1px", height: "1px", overflow: "hidden" },
});

const ICONS: Record<PortalKind, React.ReactNode> = {
  invoice: <Receipt24Regular />,
  advance: <Money24Regular />,
  order: <Cart24Regular />,
  other: <Document24Regular />,
};
const ACCEPT = ".pdf,.isdoc,.isdocx,.xml,.jpg,.jpeg,.png,.webp";
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

export function SupplierPortal({ action, info }: { action: string; info: PortalInfo }) {
  const s = useStyles();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PortalKind | null>(info.kinds.length === 1 ? info.kinds[0].value : null);
  const [regNo, setRegNo] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<PortalResult>();

  const add = (list: FileList | null) => {
    if (!list) return;
    setError(undefined);
    const next = [...files, ...Array.from(list)].slice(0, info.maxFiles);
    const big = next.find((f) => f.size > info.maxFileMb * 1024 * 1024);
    if (big) setError(`Soubor ${big.name} je větší než ${info.maxFileMb} MB.`);
    setFiles(next.filter((f) => f.size <= info.maxFileMb * 1024 * 1024));
  };

  const regOk = /^\d{8}$/.test(regNo.replace(/\s/g, ""));
  const ready = !!kind && !!name.trim() && (!info.requireRegNo || regOk) && files.length > 0 && !busy;

  async function send() {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    const fd = new FormData();
    fd.set("kind", kind!);
    fd.set("regNo", regNo);
    fd.set("name", name);
    fd.set("email", email);
    fd.set("note", note);
    fd.set("website", (document.getElementById("portal-website") as HTMLInputElement | null)?.value ?? "");
    for (const f of files) fd.append("files", f);
    try {
      const res = await fetch(action, { method: "POST", body: fd });
      const data = (await res.json()) as PortalResult;
      if (data.ok) setResult(data);
      else setError(data.error ?? data.files.find((f) => f.error)?.error ?? "Doklad se nepodařilo odeslat.");
      if (!data.ok && data.files.length) setResult(data.files.some((f) => f.ok) ? data : undefined);
    } catch {
      setError("Doklad se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu.");
    }
    setBusy(false);
  }

  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <header className={s.hero}>
          <span className={s.company}>{info.companyName}</span>
          <h1 className={s.title} style={{ margin: 0 }}>
            {info.title}
          </h1>
          <Text style={{ color: "inherit", opacity: 0.9 }}>{info.intro || "Pošlete nám fakturu, zálohovou fakturu nebo objednávku. Doklad zpracujeme a ozveme se, kdyby něco chybělo."}</Text>
        </header>

        <section className={s.card}>
          {result ? (
            <div className={s.done}>
              <CheckmarkCircle48Filled className={s.ok} />
              <Text size={600} weight="semibold">
                Děkujeme, doklady jsme přijali
              </Text>
              <div className={s.files} style={{ width: "100%" }}>
                {result.files.map((f) => (
                  <div key={f.name} className={s.file}>
                    <DocumentPdf24Regular />
                    <span style={{ flex: 1, textAlign: "left" }}>{f.name}</span>
                    {f.ok ? <Text weight="semibold">č. {f.docNum}</Text> : <Text className={s.error}>{f.error}</Text>}
                  </div>
                ))}
              </div>
              <Text className={s.muted}>Číslo si poznamenejte pro případný dotaz.</Text>
              <Button
                appearance="primary"
                onClick={() => {
                  setResult(undefined);
                  setFiles([]);
                  setNote("");
                }}
              >
                Poslat další doklad
              </Button>
            </div>
          ) : (
            <>
              <div className={s.step}>
                <div className={s.stepHead}>
                  <span className={s.num}>1</span> Co posíláte
                </div>
                <div className={s.kinds} role="radiogroup">
                  {info.kinds.map((k) => (
                    <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} className={`${s.kind} ${kind === k.value ? s.kindOn : ""}`} onClick={() => setKind(k.value)}>
                      {ICONS[k.value]}
                      <span style={{ fontWeight: 600 }}>{k.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={s.step}>
                <div className={s.stepHead}>
                  <span className={s.num}>2</span> Kdo posílá
                </div>
                <div className={s.grid2}>
                  <Field label="IČO" required={info.requireRegNo} validationMessage={regNo && !regOk ? "IČO má 8 číslic" : undefined}>
                    <Input value={regNo} inputMode="numeric" maxLength={10} onChange={(_, d) => setRegNo(d.value)} placeholder="12345678" />
                  </Field>
                  <Field label="Název firmy / jméno" required>
                    <Input value={name} maxLength={120} onChange={(_, d) => setName(d.value)} />
                  </Field>
                  <Field label="E-mail (nepovinný)">
                    <Input type="email" value={email} maxLength={254} onChange={(_, d) => setEmail(d.value)} />
                  </Field>
                  <Field label="Poznámka (nepovinná)">
                    <Textarea value={note} maxLength={255} onChange={(_, d) => setNote(d.value)} resize="vertical" />
                  </Field>
                </div>
                {/* past na roboty — člověk pole nevidí */}
                <div className={s.honey} aria-hidden="true">
                  <label htmlFor="portal-website">Web</label>
                  <input id="portal-website" name="website" tabIndex={-1} autoComplete="off" />
                </div>
              </div>

              <div className={s.step}>
                <div className={s.stepHead}>
                  <span className={s.num}>3</span> Soubory
                </div>
                <div
                  className={`${s.drop} ${over ? s.dropOn : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => input.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    add(e.dataTransfer.files);
                  }}
                >
                  <CloudArrowUp48Regular />
                  <Text weight="semibold">Přetáhněte soubory sem nebo klikněte</Text>
                  <Text size={200} className={s.muted}>
                    PDF, ISDOC, XML nebo obrázek · nejvýš {info.maxFiles} souborů po {info.maxFileMb} MB
                  </Text>
                  <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
                </div>
                {files.length > 0 && (
                  <div className={s.files}>
                    {files.map((f, i) => (
                      <div key={`${f.name}-${i}`} className={s.file}>
                        <DocumentPdf24Regular />
                        <span style={{ flex: 1 }}>{f.name}</span>
                        <Text size={200} className={s.muted}>
                          {fmtSize(f.size)}
                        </Text>
                        <Button appearance="subtle" size="small" icon={<Dismiss16Regular />} aria-label="Odebrat" onClick={() => setFiles(files.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {error && <Text className={s.error}>{error}</Text>}
              <Button appearance="primary" size="large" disabled={!ready} onClick={() => void send()} icon={busy ? <Spinner size="tiny" /> : undefined}>
                {busy ? "Odesílám…" : "Odeslat doklady"}
              </Button>
            </>
          )}
        </section>
        <div className={s.foot}>
          <ShieldCheckmark16Regular /> Soubory se přenášejí šifrovaně a zpracuje je jen {info.companyName.replace(/\.$/, "")}.
        </div>
      </div>
    </main>
  );
}
