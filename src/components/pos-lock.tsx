"use client";

/** Zamčená pokladna: zadání čtyřmístného PINu (dotyková klávesnice i klávesnice počítače). */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, makeStyles, Spinner, Text, tokens } from "@fluentui/react-components";
import { ArrowLeft24Regular, Backspace24Regular, LockClosed48Regular } from "@fluentui/react-icons";
import { posUnlockAction } from "@/app/actions";

const useStyles = makeStyles({
  page: { minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: tokens.colorNeutralBackground3, padding: "16px" },
  card: {
    width: "min(360px, 100%)",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow16,
    padding: "28px 24px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
  },
  icon: { color: tokens.colorBrandForeground1 },
  dots: { display: "flex", gap: "14px", margin: "6px 0" },
  dot: { width: "16px", height: "16px", borderRadius: "50%", border: `2px solid ${tokens.colorBrandStroke1}` },
  dotOn: { backgroundColor: tokens.colorBrandBackground },
  pad: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", width: "100%" },
  key: { height: "64px", fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightSemibold },
  err: { color: tokens.colorPaletteRedForeground1, minHeight: "20px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function PosLock(p: { registerId: string; registerName: string; user: string; backHref: string; labels: { title: string; enter: string; wrong: string; wait: string; back: string } }) {
  const s = useStyles();
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      const r = await posUnlockAction(p.registerId, value);
      setBusy(false);
      if (r.ok && r.data === "ok") return router.refresh();
      setPin("");
      setErr(r.ok && r.data === "wait" ? p.labels.wait : p.labels.wrong);
    },
    [p.registerId, p.labels, router],
  );

  const press = useCallback(
    (d: string) => {
      if (busy) return;
      setErr("");
      setPin((x) => {
        const next = (x + d).slice(0, 4);
        if (next.length === 4) void submit(next);
        return next;
      });
    },
    [busy, submit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((x) => x.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  return (
    <main className={s.page}>
      <div className={s.card}>
        <LockClosed48Regular className={s.icon} />
        <Text size={600} weight="semibold">
          {p.registerName}
        </Text>
        <Text className={s.muted}>
          {p.labels.title} · {p.user}
        </Text>
        <Text>{p.labels.enter}</Text>
        <div className={s.dots} aria-label={p.labels.enter}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`${s.dot} ${i < pin.length ? s.dotOn : ""}`} />
          ))}
        </div>
        <Text className={s.err}>{busy ? <Spinner size="tiny" /> : err}</Text>
        <div className={s.pad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <Button key={d} className={s.key} onClick={() => press(d)} disabled={busy}>
              {d}
            </Button>
          ))}
          <Button className={s.key} appearance="subtle" icon={<ArrowLeft24Regular />} aria-label={p.labels.back} onClick={() => router.push(p.backHref)} />
          <Button className={s.key} onClick={() => press("0")} disabled={busy}>
            0
          </Button>
          <Button className={s.key} appearance="subtle" icon={<Backspace24Regular />} aria-label="⌫" onClick={() => setPin((x) => x.slice(0, -1))} disabled={busy} />
        </div>
      </div>
    </main>
  );
}
