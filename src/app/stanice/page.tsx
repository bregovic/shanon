"use client";
/**
 * Vstup ze zástupce Shanon Pokladna (`/stanice?d=<zařízení>`): prohlížeč si zapamatuje, že běží na počítači
 * s tiskovou stanicí (tisk z něj má přednost na její tiskárny, src/server/station.ts), a pokračuje na úvod —
 * přihlášení, pokladník rovnou do kasy.
 */
import { useEffect } from "react";
import { STATION_KEY } from "@/lib/station-print";

export default function StationEntry() {
  useEffect(() => {
    const d = new URLSearchParams(location.search).get("d");
    try {
      if (d && /^[0-9a-f-]{36}$/.test(d)) localStorage.setItem(STATION_KEY, d);
    } catch {
      /* bez úložiště prohlížeče tiskne podle pravidel bez ohledu na počítač */
    }
    location.replace("/");
  }, []);
  return null;
}
