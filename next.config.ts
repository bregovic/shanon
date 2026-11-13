import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // importy (CSV/XML/Excel i se složkou obrázků) a výpisy jdou přes server actions
    serverActions: { bodySizeLimit: "30mb" },
    // proxy (přesměrování nepřihlášených) si tělo požadavku drží v paměti
    proxyClientMaxBodySize: "30mb",
  },
};

export default nextConfig;
