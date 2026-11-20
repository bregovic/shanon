"use client";
/**
 * Nainstalovat webovou aplikaci (Shanon / Portál): Chrome, Edge, Android = systémová nabídka instalace
 * (`beforeinstallprompt`), iPhone / iPad = návod Sdílet → Přidat na plochu. Už nainstalovaná = jen informace.
 */
import { useState, useSyncExternalStore } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Text } from "@fluentui/react-components";
import { ArrowDownload24Regular, Checkmark24Regular } from "@fluentui/react-icons";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// událost přichází jednou, často dřív, než se komponenta vykreslí — zachytit hned po načtení
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const standalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
const ios = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
/** stav pro vykreslení: nainstalováno / nabídka prohlížeče / návod pro iPhone / nic (na serveru null) */
const snapshot = () => (standalone() ? "installed" : deferred ? "prompt" : ios() ? "ios" : "none");

export function InstallAppButton({ label, iosText, installedText, appearance = "secondary", iconOnly = false }: { label: string; iosText: string; installedText: string; appearance?: "secondary" | "primary" | "subtle"; iconOnly?: boolean }) {
  const state = useSyncExternalStore(subscribe, snapshot, () => null);
  const [iosHelp, setIosHelp] = useState(false);
  if (!state) return null;
  if (state === "installed")
    return iconOnly ? null : (
      <Text size={200} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Checkmark24Regular /> {installedText}
      </Text>
    );
  // prohlížeč instalaci nenabízí (Firefox, už nainstalováno jinde) a není to iPhone → tlačítko nemá smysl
  if (state === "none") return null;
  return (
    <>
      <Button
        appearance={appearance}
        icon={<ArrowDownload24Regular />}
        aria-label={label}
        title={label}
        style={iconOnly ? { color: "inherit" } : undefined}
        onClick={async () => {
          if (deferred) {
            await deferred.prompt();
            await deferred.userChoice.catch(() => undefined);
            deferred = null;
            listeners.forEach((l) => l());
          } else setIosHelp(true);
        }}
      >
        {iconOnly ? null : label}
      </Button>
      <Dialog open={iosHelp} onOpenChange={(_, d) => setIosHelp(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{label}</DialogTitle>
            <DialogContent>{iosText}</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => setIosHelp(false)}>
                OK
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
