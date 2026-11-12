"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-md px-2 py-1.5 text-sm transition",
        active ? "bg-accent-soft font-medium text-accent" : "text-fg hover:bg-surface-2",
      )}
    >
      {children}
    </Link>
  );
}
