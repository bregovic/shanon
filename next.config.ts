import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // importy (CSV/XML/Excel) a výpisy jdou přes server actions
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
