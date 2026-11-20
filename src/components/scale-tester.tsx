"use client";
/**
 * Zkouška váhy na sériovém portu (Web Serial, Chrome / Edge): ruční dotazy s výpisem bajtů (HEX + text)
 * a automatické hledání nastavení (rychlost × parita × dotaz běžných protokolů). Nalezené nastavení jde
 * uložit do napojení váhy. Slouží k rozchození nové váhy, než se zná její protokol.
 */
import { useState, useSyncExternalStore } from "react";
import { Badge, Button, Dropdown, Field, Input, makeStyles, MessageBar, MessageBarBody, Option, ProgressBar, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, tokens } from "@fluentui/react-components";
import { PlugConnected24Regular, Search24Regular, Send24Regular } from "@fluentui/react-icons";
import { saveRecordAction } from "@/app/actions";
import { connectScalePort, parseScale, serialExchange, type ReadablePort, type ScaleProtocol, type SerialSettings } from "@/lib/scale";
import { toast } from "./toast";
import { DIALOG06_LINE, encodeStatusRequest, encodeUnitPrice, parseDialog06 } from "@/lib/dialog06";

const PROBES: { id: string; bytes: number[] }[] = [
  { id: "listen", bytes: [] },
  { id: "W", bytes: [0x57] },
  { id: "ENQ DC1", bytes: [0x05, 0x11] },
  { id: "ENQ", bytes: [0x05] },
  // Dialog 02 / 04 / 06 (TEM, Bizerba): dotaz na hmotnost
  { id: "EOT ENQ", bytes: [0x04, 0x05] },
  { id: "DC1", bytes: [0x11] },
  { id: "S CR LF", bytes: [0x53, 0x0d, 0x0a] },
  { id: "SI CR LF", bytes: [0x53, 0x49, 0x0d, 0x0a] },
  { id: "P", bytes: [0x50] },
  { id: "ESC P", bytes: [0x1b, 0x50] },
];
// pořadí podle četnosti u pokladních vah (rychlé nalezení obvyklého nastavení)
const BAUDS = [9600, 19200, 4800, 38400, 2400, 57600, 115200, 1200];
const FRAMES: Pick<SerialSettings, "dataBits" | "parity">[] = [
  { dataBits: 8, parity: "none" },
  { dataBits: 7, parity: "odd" },
  { dataBits: 7, parity: "even" },
  { dataBits: 8, parity: "even" },
  { dataBits: 8, parity: "odd" },
];

/** Rozbor odpovědi bez znalosti protokolu: co váha poslala a co to znamená pro diagnózu. */
type Kind = "weight" | "ack" | "nak" | "text" | "noise";
function classify(bytes: number[], parsed: Hit["parsed"]): { kind: Kind; score: number } {
  if (parsed && parsed.kg !== null) return { kind: "weight", score: 100 };
  if (bytes.length === 1 && bytes[0] === 0x06) return { kind: "ack", score: 60 };
  if (bytes.length === 1 && bytes[0] === 0x15) return { kind: "nak", score: 50 };
  if (parsed?.note === "ACK") return { kind: "ack", score: 60 };
  if (parsed?.note === "NAK") return { kind: "nak", score: 50 };
  if (parsed) return { kind: "ack", score: 70 }; // stav Dialog 06 (váha rozumí, např. bez zátěže)
  const printable = bytes.filter((b) => (b >= 0x20 && b < 0x7f) || b === 0x0d || b === 0x0a).length;
  if (bytes.length >= 3 && printable / bytes.length > 0.8 && /\d/.test(String.fromCharCode(...bytes))) return { kind: "text", score: 40 };
  return { kind: "noise", score: 1 };
}
const PROTOCOLS: ScaleProtocol[] = ["toledo8217", "casEcr", "continuous"];
const PROBE_FOR: Record<ScaleProtocol, string> = { toledo8217: "W", casEcr: "ENQ DC1", continuous: "listen" };

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, "0")).join(" ");
const ascii = (b: number[]) => b.map((x) => (x === 0x0d ? "⏎" : x === 0x0a ? "↵" : x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : "·")).join("");
const settingsText = (s: SerialSettings) => `${s.baudRate} ${s.dataBits}${s.parity[0].toUpperCase()}${s.stopBits}`;

interface Hit {
  settings: SerialSettings;
  probe: string;
  bytes: number[];
  /** rozpoznaný protokol a hmotnost (null = odpověď neznámého tvaru) */
  parsed: { protocol: ScaleProtocol | "dialog06"; kg: number | null; stable: boolean; note?: string } | null;
}

/** Dialog 06 (ověřená váha TEM): cena za kg → ACK, pak EOT ENQ → hmotnost a cena z váhy, nebo stav */
function recognizeDialog06(bytes: number[]): Hit["parsed"] {
  let rest = bytes;
  let best: Hit["parsed"] = null;
  for (let guard = 0; rest.length && guard < 10; guard++) {
    const r = parseDialog06(rest);
    if (!r) break;
    rest = rest.slice(r.used);
    const m = r.msg;
    if (m.kind === "data") return { protocol: "dialog06", kg: Number(m.weight.replace(",", ".")), stable: true, note: `${m.unitPrice} Kč/kg → ${m.total} Kč` };
    if (m.kind === "status") best = { protocol: "dialog06", kg: null, stable: false, note: m.status };
    if (m.kind === "ack" && !best) best = { protocol: "dialog06", kg: null, stable: false, note: "ACK" };
    if (m.kind === "nak" && !best) best = { protocol: "dialog06", kg: null, stable: false, note: "NAK" };
  }
  return best;
}

function recognize(probe: string, bytes: number[]): Hit["parsed"] {
  for (const pr of PROTOCOLS) {
    if (PROBE_FOR[pr] !== probe) continue;
    const r = parseScale(pr, bytes);
    if (r && r.kg !== null) return { protocol: pr, kg: r.kg, stable: r.stable };
  }
  return null;
}

const useStyles = makeStyles({
  row: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS, alignItems: "end" },
  log: { fontFamily: "Consolas, monospace", fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all", backgroundColor: tokens.colorNeutralBackground3, padding: tokens.spacingHorizontalS, borderRadius: tokens.borderRadiusMedium, maxHeight: "260px", overflowY: "auto" },
  mono: { fontFamily: "Consolas, monospace", fontSize: "12px", wordBreak: "break-all" },
  wrap: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, maxWidth: "1000px" },
  scroll: { overflowX: "auto" },
});

export function ScaleTester({ connections, L }: { connections: { id: string; code: string; name: string; version: number }[]; L: Record<string, string> }) {
  const st = useStyles();
  const [port, setPort] = useState<ReadablePort | null>(null);
  const [s, setS] = useState<SerialSettings>({ baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 });
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [custom, setCustom] = useState("");
  const [verdict, setVerdict] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [connId, setConnId] = useState(connections[0]?.id ?? "");
  // podpora sériového portu jen v prohlížeči (na serveru null → nic, bez nesouladu při hydrataci)
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => "serial" in navigator,
    () => null,
  );

  const add = (line: string) => setLog((l) => [...l.slice(-200), `${new Date().toLocaleTimeString("cs-CZ")}  ${line}`]);

  const once = async (probe: string, bytes: number[], settings = s) => {
    if (!port) return [] as number[];
    add(`→ [${settingsText(settings)}] ${probe}${bytes.length ? `  ${hex(bytes)}` : ""}`);
    const got = await serialExchange(port, settings, Uint8Array.from(bytes), probe === "listen" ? 1500 : 800);
    add(got.length ? `← ${got.length} B  ${hex(got)}\n   ${ascii(got)}` : `← ${L.NoAnswer}`);
    return got;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      add(`! ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /** Dialog 06 na jednom nastavení linky: cena 100,00 Kč/kg → potvrzení → EOT ENQ; true = váha odpověděla */
  const d06Once = async (settings: SerialSettings): Promise<boolean> => {
    if (!port) return false;
    const price = Array.from(encodeUnitPrice(10000));
    add(`→ [${settingsText(settings)}] Dialog 06 cena 100,00 Kč/kg  ${hex(price)}`);
    const a = await serialExchange(port, settings, Uint8Array.from(price), 700);
    add(a.length ? `← ${hex(a)}   ${ascii(a)}` : `← ${L.NoAnswer}`);
    const req = Array.from(encodeStatusRequest());
    add(`→ [${settingsText(settings)}] Dialog 06 EOT ENQ  ${hex(req)}`);
    const b = await serialExchange(port, settings, Uint8Array.from(req), 1200);
    add(b.length ? `← ${hex(b)}   ${ascii(b)}` : `← ${L.NoAnswer}`);
    if (!a.length && !b.length) return false;
    setHits((h) => [...h, { settings, probe: "Dialog 06", bytes: [...a, ...b], parsed: recognizeDialog06([...a, ...b]) }]);
    return true;
  };

  /** Dialog 06 na nastavené rychlosti / rámci, nebo na všech obvyklých (9600, 19200 × 7O1 7E1 8N1 8E1 8O1) */
  const dialog06 = (all: boolean) =>
    run(async () => {
      const list: SerialSettings[] = all
        ? [9600, 19200].flatMap((baudRate) =>
            ([[7, "odd"], [7, "even"], [8, "none"], [8, "even"], [8, "odd"]] as const).map(([dataBits, parity]) => ({ baudRate, dataBits, parity, stopBits: 1 as const })),
          )
        : [{ baudRate: s.baudRate, ...DIALOG06_LINE }];
      let n = 0;
      for (const set of list) {
        if (all) setProgress(++n / list.length);
        try {
          await d06Once(set);
        } catch (e) {
          add(`! ${settingsText(set)}: ${String((e as Error).message ?? e)}`);
        }
      }
    });

  /**
   * Diagnostika: rychlosti z běžných vah × rámce linky × dotazy všech podporovaných protokolů (vč. Dialog 06).
   * Každou odpověď zařadí (hmotnost / potvrzení ACK / odmítnutí NAK / text s čísly / šum) a na konci napíše,
   * které nastavení linky váha nejspíš používá a co dál. Skončí u první rozpoznané hmotnosti.
   */
  const scan = () =>
    run(async () => {
      if (!port) return;
      setHits([]);
      setVerdict(null);
      const combos = BAUDS.flatMap((baudRate) => FRAMES.map((f) => ({ ...f, baudRate, stopBits: 1 as const })));
      const probes = [...PROBES.map((p) => p.id), "Dialog 06"];
      const total = combos.length * probes.length;
      let n = 0;
      const found: (Hit & { kind: Kind; score: number })[] = [];
      const errors = new Map<string, number>();
      outer: for (const settings of combos) {
        for (const id of probes) {
          setProgress(++n / total);
          let got: number[] = [];
          try {
            if (id === "Dialog 06") {
              const a = await serialExchange(port, settings, encodeUnitPrice(10000), 600);
              const b = await serialExchange(port, settings, encodeStatusRequest(), 900);
              got = [...a, ...b];
            } else {
              const p = PROBES.find((x) => x.id === id)!;
              got = await serialExchange(port, settings, Uint8Array.from(p.bytes), id === "listen" ? 1200 : 500);
            }
          } catch (e) {
            // chyba rámce / parity = data na lince jsou, ale s jiným nastavením
            const key = settingsText(settings);
            errors.set(key, (errors.get(key) ?? 0) + 1);
            add(`! ${key} ${id}: ${String((e as Error).message ?? e)}`);
            continue;
          }
          if (!got.length) continue;
          const parsed = id === "Dialog 06" ? recognizeDialog06(got) : recognize(id, got);
          const c = classify(got, parsed);
          found.push({ settings, probe: id, bytes: got, parsed, ...c });
          setHits([...found]);
          add(`← [${settingsText(settings)}] ${id}: ${ascii(got)}   HEX ${hex(got)}   (${L[`K_${c.kind}`]})`);
          if (c.kind === "weight") break outer;
        }
      }
      // diagnóza: nejlepší nastavení linky podle součtu „smysluplných“ odpovědí
      const by = new Map<string, { settings: SerialSettings; score: number; kinds: Set<Kind>; probes: string[] }>();
      for (const h of found) {
        const k = settingsText(h.settings);
        const x = by.get(k) ?? { settings: h.settings, score: 0, kinds: new Set<Kind>(), probes: [] };
        x.score += h.score;
        x.kinds.add(h.kind);
        if (h.kind !== "noise") x.probes.push(h.probe);
        by.set(k, x);
      }
      const best = [...by.values()].sort((a, b) => b.score - a.score)[0];
      const weight = found.find((h) => h.kind === "weight");
      const lines: string[] = [];
      if (weight) lines.push(L.DiagWeight.replace("{settings}", settingsText(weight.settings)).replace("{protocol}", L[`P_${weight.parsed!.protocol}`] ?? weight.parsed!.protocol));
      else if (best && (best.kinds.has("ack") || best.kinds.has("nak"))) lines.push(L.DiagLine.replace("{settings}", settingsText(best.settings)).replace("{probes}", [...new Set(best.probes)].join(", ")));
      else if (best && best.kinds.has("text")) lines.push(L.DiagText.replace("{settings}", settingsText(best.settings)));
      else if (found.length || errors.size) lines.push(L.DiagNoise);
      else lines.push(L.DiagSilent);
      if (!weight) lines.push(L.DiagNext);
      setVerdict({ ok: !!weight, lines });
      add(found.length ? L.ScanDone.replace("{n}", String(found.length)) : L.ScanNothing);
    });

  const save = async (h: Hit) => {
    if (!h.parsed || !connId) return;
    const c = connections.find((x) => x.id === connId);
    const r = await saveRecordAction("int.connection", connId, { scaleProtocol: h.parsed.protocol, baudRate: h.settings.baudRate, dataBits: h.settings.dataBits, parity: h.settings.parity, stopBits: h.settings.stopBits }, c?.version);
    toast(r.ok ? L.Saved : r.message, r.ok ? "success" : "warning");
  };

  if (supported === null) return null;
  if (!supported)
    return (
      <MessageBar intent="warning">
        <MessageBarBody>{L.Unsupported}</MessageBarBody>
      </MessageBar>
    );

  return (
    <div className={st.wrap}>
      <Text>{L.Intro}</Text>
      <div className={st.row}>
        <Button appearance={port ? "secondary" : "primary"} icon={<PlugConnected24Regular />} disabled={busy} onClick={async () => setPort(await connectScalePort())}>
          {port ? L.Reconnect : L.Connect}
        </Button>
        {port && <Badge color="success">{L.Connected}</Badge>}
        <Field label={L.Baud}>
          <Dropdown value={String(s.baudRate)} selectedOptions={[String(s.baudRate)]} onOptionSelect={(_, d) => setS({ ...s, baudRate: Number(d.optionValue) })}>
            {[1200, 2400, 4800, 9600, 19200, 38400].map((b) => (
              <Option key={b} value={String(b)}>
                {String(b)}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label={L.Frame}>
          <Dropdown
            value={`${s.dataBits}${s.parity[0].toUpperCase()}${s.stopBits}`}
            selectedOptions={[`${s.dataBits}-${s.parity}-${s.stopBits}`]}
            onOptionSelect={(_, d) => {
              const [db, par, sb] = String(d.optionValue).split("-");
              setS({ ...s, dataBits: Number(db) as 7 | 8, parity: par as SerialSettings["parity"], stopBits: Number(sb) as 1 | 2 });
            }}
          >
            {["8-none-1", "7-even-1", "7-odd-1", "8-even-1", "8-odd-1", "8-none-2"].map((f) => (
              <Option key={f} value={f}>
                {f.replace(/-(\w)\w*-/, (_, p: string) => p.toUpperCase()).replace(/-/g, "")}
              </Option>
            ))}
          </Dropdown>
        </Field>
      </div>

      <Text weight="semibold">{L.Manual}</Text>
      <div className={st.row}>
        {PROBES.map((p) => (
          <Button key={p.id} size="small" disabled={!port || busy} onClick={() => run(async () => void (await once(p.id, p.bytes)))}>
            {p.id === "listen" ? L.Listen : p.id}
          </Button>
        ))}
        <Input size="small" value={custom} onChange={(_, d) => setCustom(d.value)} placeholder={L.CustomHint} />
        <Button
          size="small"
          icon={<Send24Regular />}
          disabled={!port || busy || !custom}
          onClick={() =>
            run(async () => {
              // „57 0d“ = HEX, jinak text (\r \n jako CR LF)
              const bytes = /^([0-9a-f]{2}\s*)+$/i.test(custom.trim()) ? custom.trim().split(/\s+/).map((h) => parseInt(h, 16)) : [...custom.replace(/\\r/g, "\r").replace(/\\n/g, "\n")].map((c) => c.charCodeAt(0));
              await once(custom, bytes);
            })
          }
        >
          {L.Send}
        </Button>
      </div>

      <div className={st.row}>
        <Button appearance="primary" disabled={!port || busy} onClick={() => dialog06(false)}>
          {L.Dialog06}
        </Button>
        <Button disabled={!port || busy} onClick={() => dialog06(true)}>
          {L.Dialog06All}
        </Button>
        <Button icon={<Search24Regular />} disabled={!port || busy} onClick={scan}>
          {L.Scan}
        </Button>
        <Text size={200}>{L.ScanHint}</Text>
      </div>
      {progress !== null && <ProgressBar value={progress} />}
      {verdict && (
        <MessageBar intent={verdict.ok ? "success" : "warning"} layout="multiline">
          <MessageBarBody>
            {verdict.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </MessageBarBody>
        </MessageBar>
      )}

      {hits.length > 0 && (
        <div className={st.scroll}>
          <Table size="small" style={{ tableLayout: "auto", minWidth: 760 }}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{L.Settings}</TableHeaderCell>
                <TableHeaderCell>{L.Probe}</TableHeaderCell>
                <TableHeaderCell>{L.Answer}</TableHeaderCell>
                <TableHeaderCell>{L.Weight}</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hits.map((h, i) => (
                <TableRow key={i}>
                  <TableCell>{settingsText(h.settings)}</TableCell>
                  <TableCell>{h.probe === "listen" ? L.Listen : h.probe}</TableCell>
                  <TableCell>
                    <div className={st.mono}>{ascii(h.bytes).slice(0, 80)}</div>
                    <div className={st.mono} style={{ color: tokens.colorNeutralForeground3 }}>
                      {hex(h.bytes).slice(0, 120)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {h.parsed
                      ? [h.parsed.kg !== null ? `${h.parsed.kg.toFixed(3)} kg` : null, L[`P_${h.parsed.protocol}`] ?? h.parsed.protocol, h.parsed.note, h.parsed.kg !== null && !h.parsed.stable ? L.Unstable : null].filter(Boolean).join(" · ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {h.parsed && connections.length > 0 && (
                      <Button size="small" appearance="primary" onClick={() => void save(h)}>
                        {L.Use}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {connections.length > 0 ? (
        <Field label={L.SaveTo}>
          <Dropdown value={connections.find((c) => c.id === connId)?.code ?? ""} selectedOptions={[connId]} onOptionSelect={(_, d) => setConnId(String(d.optionValue))}>
            {connections.map((c) => (
              <Option key={c.id} value={c.id} text={c.code}>
                {`${c.code} · ${c.name}`}
              </Option>
            ))}
          </Dropdown>
        </Field>
      ) : (
        <Text size={200}>{L.NoConnection}</Text>
      )}

      <Text weight="semibold">{L.Log}</Text>
      <div className={st.log}>{log.length ? log.join("\n") : "—"}</div>
    </div>
  );
}
