import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF sestav: pdfkit čte svá data (metriky písem) ze souborů balíčku
  serverExternalPackages: ["pdfkit"],
  experimental: {
    // importy (CSV/XML/Excel i se složkou obrázků) a výpisy jdou přes server actions
    serverActions: { bodySizeLimit: "30mb" },
    // proxy (přesměrování nepřihlášených) si tělo požadavku drží v paměti
    proxyClientMaxBodySize: "30mb",
  },
};

export default nextConfig;
