/**
 * Tisk tiskové stránky (/print/<doklad>/<id>) ze skrytého rámu — bez přechodu jinam (kasa po prodeji).
 * Tiskne se stejná stránka jako ze seznamu dokladů, takže výsledek je všude stejný.
 */
export function printInFrame(url: string): Promise<void> {
  return new Promise((resolve) => {
    const f = document.createElement("iframe");
    // mimo obrazovku, ale s rozměry (prohlížeče netisknou rám bez rozměrů)
    f.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
    f.setAttribute("aria-hidden", "true");
    const done = () => {
      setTimeout(() => f.remove(), 1000);
      resolve();
    };
    f.onload = () => {
      // obrázky a QR kód se dokreslí
      setTimeout(() => {
        try {
          const w = f.contentWindow;
          if (!w) return done();
          w.addEventListener("afterprint", done, { once: true });
          w.focus();
          w.print();
          // Safari / Firefox nemusí afterprint poslat
          setTimeout(done, 60_000);
        } catch {
          done();
        }
      }, 400);
    };
    f.src = url;
    document.body.appendChild(f);
  });
}
