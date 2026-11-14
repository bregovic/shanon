"use client";

/** Výběr pokladny: dlaždice se stavem směny a zámkem. */
import Link from "next/link";
import { Badge, makeStyles, Text, tokens } from "@fluentui/react-components";
import { ArrowLeft24Regular, LockClosed20Regular, Receipt24Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  page: { minHeight: "100dvh", backgroundColor: tokens.colorNeutralBackground3, padding: "24px 16px" },
  wrap: { maxWidth: "960px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "18px" },
  head: { display: "flex", alignItems: "center", gap: "12px" },
  back: { display: "inline-flex", alignItems: "center", gap: "6px", color: tokens.colorNeutralForeground2, textDecoration: "none" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "14px" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "20px",
    minHeight: "150px",
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    color: tokens.colorNeutralForeground1,
    textDecoration: "none",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    ":hover": { boxShadow: tokens.shadow16, border: `1px solid ${tokens.colorBrandStroke1}` },
  },
  row: { display: "flex", alignItems: "center", gap: "8px" },
  icon: { color: tokens.colorBrandForeground1 },
  spacer: { flex: 1 },
  muted: { color: tokens.colorNeutralForeground3 },
});

export interface RegisterTile {
  id: string;
  code: string;
  name: string;
  locked: boolean;
  shift: { num: string; since: string; receipts: number } | null;
}

export function PosRegisterPicker(p: { registers: RegisterTile[]; labels: Record<"title" | "none" | "back" | "open" | "closed" | "receipts" | "pin", string> }) {
  const s = useStyles();
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <div className={s.head}>
          <Link href="/pos" className={s.back}>
            <ArrowLeft24Regular /> {p.labels.back}
          </Link>
        </div>
        <Text size={800} weight="semibold">
          {p.labels.title}
        </Text>
        {!p.registers.length && <Text>{p.labels.none}</Text>}
        <div className={s.grid}>
          {p.registers.map((r) => (
            <Link key={r.id} href={`/kasa/${r.id}`} className={s.card}>
              <div className={s.row}>
                <Receipt24Regular className={s.icon} />
                <Text size={500} weight="semibold">
                  {r.name}
                </Text>
                <span className={s.spacer} />
                {r.locked && <LockClosed20Regular aria-label={p.labels.pin} className={s.muted} />}
              </div>
              <Text className={s.muted}>{r.code}</Text>
              <span className={s.spacer} />
              {r.shift ? (
                <div className={s.row}>
                  <Badge color="success">{`${p.labels.open} ${r.shift.num}`}</Badge>
                  <Text size={200} className={s.muted}>
                    {r.shift.since} · {p.labels.receipts.replace("{n}", String(r.shift.receipts))}
                  </Text>
                </div>
              ) : (
                <div className={s.row}>
                  <Badge color="informative" appearance="tint">
                    {p.labels.closed}
                  </Badge>
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
