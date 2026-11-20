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
const BAUDS = [9600, 4800, 2400, 19200, 1200];
const FRAMES: Pick<SerialSettings, "dataBits" | "parity">[] = [
  { dataBits: 8, parity: "none" },
  { dataBits: 7, parity: "even" },
  { dataBits: 7, parity: "odd" },
  { dataBits: 8, parity: "even" },
];
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
  parsed: { protocol: ScaleProtocol; kg: number | null; stable: boolean } | null;
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

  const scan = () =>
    run(async () => {
      if (!port) return;
      setHits([]);
      const combos = BAUDS.flatMap((baudRate) => FRAMES.map((f) => ({ ...f, baudRate, stopBits: 1 as const })));
      const total = combos.length * PROBES.length;
      let n = 0;
      const found: Hit[] = [];
      for (const settings of combos) {
        for (const p of PROBES) {
          setProgress(++n / total);
          let got: number[] = [];
          try {
            got = await serialExchange(port, settings, Uint8Array.from(p.bytes), p.id === "listen" ? 1200 : 600);
          } catch (e) {
            add(`! ${settingsText(settings)} ${p.id}: ${String((e as Error).message ?? e)}`);
            continue;
          }
          if (!got.length) continue;
          const hit: Hit = { settings, probe: p.id, bytes: got, parsed: recognize(p.id, got) };
          found.push(hit);
          setHits([...found]);
          add(`← [${settingsText(settings)}] ${p.id}: ${ascii(got)}   HEX ${hex(got)}`);
        }
        // rozpoznaná hmotnost = máme nastavení, dál nehledat
        if (found.some((h) => h.parsed && h.settings === settings)) break;
      }
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
        <Button appearance="primary" icon={<Search24Regular />} disabled={!port || busy} onClick={scan}>
          {L.Scan}
        </Button>
        <Text size={200}>{L.ScanHint}</Text>
      </div>
      {progress !== null && <ProgressBar value={progress} />}

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
                  <TableCell>{h.parsed ? `${h.parsed.kg?.toFixed(3)} kg · ${L[`P_${h.parsed.protocol}`] ?? h.parsed.protocol}${h.parsed.stable ? "" : ` · ${L.Unstable}`}` : "—"}</TableCell>
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
