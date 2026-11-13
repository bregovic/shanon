/** Tisk dokladů — bez hlavičky aplikace (jen stránka dokladu a lišta tisku). */
import { requireSession } from "@/server/auth";

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return children;
}
