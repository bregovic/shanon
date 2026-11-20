"use client";
/**
 * Tiskový dialog (seznam i detail dokladu): náhled tiskové stránky v rámu (šablona se vybírá v náhledu),
 * Tisk (tiskne rám, bez nové stránky), PDF, Odeslat e-mailem (jeden doklad s akcí `email` — koncept
 * v Odeslané poště), Otevřít v novém okně.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, makeStyles, Spinner, tokens } from "@fluentui/react-components";
import { DocumentPdf24Regular, Mail24Regular, Open24Regular, Print24Regular } from "@fluentui/react-icons";
import { runRecordAction } from "@/app/actions";
import { toast } from "./toast";

export interface PrintDialogLabels {
  title: string;
  print: string;
  pdf: string;
  email: string;
  newWindow: string;
  close: string;
}

const useStyles = makeStyles({
  surface: { width: "min(1100px, 96vw)", maxWidth: "96vw", height: "min(92vh, 1000px)", display: "flex", flexDirection: "column", padding: tokens.spacingHorizontalL },
  body: { display: "flex", flexDirection: "column", height: "100%", gap: tokens.spacingVerticalS },
  content: { flexGrow: 1, minHeight: 0, display: "flex" },
  frame: { flexGrow: 1, width: "100%", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, backgroundColor: "#e9e9e9" },
  actions: { flexWrap: "wrap", justifyContent: "flex-end" },
});

const embed = (url: string) => `${url}${url.includes("?") ? "&" : "?"}embed=1`;

export function PrintDialog({
  open,
  onClose,
  src,
  pdfHref,
  email,
  labels: L,
}: {
  open: boolean;
  onClose: () => void;
  /** tisková stránka (/print/<doklad>/<id> nebo /batch?ids=) */
  src: string;
  pdfHref?: string;
  /** Odeslat e-mailem: doklad s akcí `email` (jen jeden vybraný) */
  email?: { objectId: string; id: string } | null;
  labels: PrintDialogLabels;
}) {
  const s = useStyles();
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // šablona vybraná v náhledu (rám mění adresu) → PDF a nové okno se stejnou šablonou
  const current = () => {
    try {
      const u = new URL(frame.current?.contentWindow?.location.href ?? "", location.origin);
      u.searchParams.delete("embed");
      return { page: `${u.pathname}${u.search}`, template: u.searchParams.get("template") };
    } catch {
      return { page: src, template: null };
    }
  };
  const withTemplate = (href: string) => {
    const t = current().template;
    return t ? `${href}${href.includes("?") ? "&" : "?"}template=${encodeURIComponent(t)}` : href;
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={s.surface}>
        <DialogBody className={s.body}>
          <DialogTitle>{L.title}</DialogTitle>
          <DialogContent className={s.content}>
            {loading && <Spinner style={{ position: "absolute", left: "50%", top: "50%" }} />}
            {open && <iframe ref={frame} className={s.frame} src={embed(src)} title={L.title} onLoad={() => setLoading(false)} />}
          </DialogContent>
          <DialogActions className={s.actions}>
            {email && (
              <Button
                icon={<Mail24Regular />}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await runRecordAction(email.objectId, email.id, "email");
                  setBusy(false);
                  if (!r.ok) return toast(r.message, "warning");
                  if (r.data?.open) router.push(r.data.open);
                  onClose();
                }}
              >
                {L.email}
              </Button>
            )}
            {pdfHref && (
              <Button icon={<DocumentPdf24Regular />} onClick={() => window.open(withTemplate(pdfHref), "_blank")}>
                {L.pdf}
              </Button>
            )}
            <Button appearance="subtle" icon={<Open24Regular />} onClick={() => window.open(current().page, "_blank")}>
              {L.newWindow}
            </Button>
            <Button onClick={onClose}>{L.close}</Button>
            <Button
              appearance="primary"
              icon={<Print24Regular />}
              disabled={loading}
              onClick={() => {
                const w = frame.current?.contentWindow;
                if (!w) return;
                w.focus();
                w.print();
              }}
            >
              {L.print}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
