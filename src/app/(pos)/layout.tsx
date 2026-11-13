/** Terminál pokladny — celá obrazovka bez hlavičky administrace. */
import { requireSession } from "@/server/auth";

export default async function PosLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return children;
}
