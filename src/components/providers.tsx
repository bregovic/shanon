"use client";

/**
 * Fluent UI v9 s vykreslením stylů na serveru (bez probliknutí) a motivem
 * v barvách loga Shanon.
 */
import { useRef, useState } from "react";
import { useServerInsertedHTML } from "next/navigation";
import {
  createDOMRenderer,
  createLightTheme,
  FluentProvider,
  RendererProvider,
  renderToStyleElements,
  SSRProvider,
  type BrandVariants,
  type Theme,
} from "@fluentui/react-components";

/** Odstíny modré z loga (tmavá navy → azurová). */
const shanonBrand: BrandVariants = {
  10: "#020a1c",
  20: "#071630",
  30: "#0a2149",
  40: "#0c2b60",
  50: "#0d3577",
  60: "#0e3f8e",
  70: "#0f4aa3",
  80: "#1156b8",
  90: "#2a68c4",
  100: "#437ace",
  110: "#5b8dd7",
  120: "#74a0e0",
  130: "#8db3e8",
  140: "#a7c6ef",
  150: "#c1d9f6",
  160: "#dbebfb",
};

export const shanonTheme: Theme = {
  ...createLightTheme(shanonBrand),
  fontFamilyBase: "var(--font-geist-sans), 'Segoe UI', system-ui, sans-serif",
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [renderer] = useState(() => createDOMRenderer());
  const done = useRef(false);
  useServerInsertedHTML(() => {
    if (done.current) return null;
    done.current = true;
    return <>{renderToStyleElements(renderer)}</>;
  });
  return (
    <RendererProvider renderer={renderer}>
      <SSRProvider>
        <FluentProvider theme={shanonTheme} style={{ minHeight: "100vh", background: "transparent" }}>
          {children}
        </FluentProvider>
      </SSRProvider>
    </RendererProvider>
  );
}
