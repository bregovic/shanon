/** Aplikace Portál — vlastní instalovatelná aplikace (manifest, ikona), bez hlavičky Shanonu. */
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "Portál", template: "%s · Portál" },
  manifest: "/portal-app.webmanifest",
  appleWebApp: { capable: true, title: "Portál", statusBarStyle: "default" },
  icons: { apple: "/icons/portal-192.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#1f4e79", width: "device-width", initialScale: 1 };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
