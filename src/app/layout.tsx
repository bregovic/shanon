import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: { default: "Shanon", template: "%s · Shanon" },
  // instalovatelná aplikace (Portál má vlastní manifest v src/app/p/layout.tsx)
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Shanon", statusBarStyle: "default" },
  icons: { apple: "/icons/shanon-192.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs" className={geistSans.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
