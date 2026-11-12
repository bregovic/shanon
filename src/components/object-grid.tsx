import Link from "next/link";
import type { RecordData } from "@/core/module";
import type { ListResult } from "@/server/data";
import { displayValue, objectHref, type FieldMeta } from "@/server/ui";
import { cn } from "@/lib/cn";

export interface GridProps {
  objectId: string;
  columns: FieldMeta[];
  result: ListResult;
  lang: string;
  labels: { empty: string; records: string; previous: string; next: string };
  /** odkazy na řazení/stránkování; null = bez ovládání (řádky ve formuláři) */
  query?: { q?: string; sort?: string; dir?: string } | null;
  basePath?: string;
  /** odkud se vracet z detailu */
  back?: string;
}

function href(base: string, q: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function ObjectGrid({ objectId, columns, result, lang, labels, query, basePath, back }: GridProps) {
  const base = basePath ?? objectHref(objectId);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const rowHref = (r: RecordData) => objectHref(objectId, String(r.id)) + (back ? `?back=${encodeURIComponent(back)}` : "");

  if (result.rows.length === 0) {
    return <div className="card px-5 py-10 text-center text-sm text-muted">{labels.empty}</div>;
  }
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
            <tr>
              {columns.map((c) => {
                const active = query?.sort === c.name;
                const nextDir = active && query?.dir !== "desc" ? "desc" : "asc";
                return (
                  <th key={c.name} className={cn("whitespace-nowrap px-4 py-2.5 font-medium", c.align === "right" && "text-right")}>
                    {query && !c.ext ? (
                      <Link href={href(base, { q: query.q, sort: c.name, dir: nextDir })} className="hover:text-fg">
                        {c.label}
                        {active ? (query.dir === "desc" ? " ↓" : " ↑") : ""}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={String(r.id)} className="border-b border-line last:border-0 hover:bg-surface-2">
                {columns.map((c, i) => (
                  <td
                    key={c.name}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5",
                      c.align === "right" && "text-right tabular-nums",
                      c.kind === "decimal" && String(r[c.name]).startsWith("-") && "text-danger",
                    )}
                  >
                    {i === 0 ? (
                      <Link href={rowHref(r)} className="font-medium text-accent hover:underline">
                        {displayValue(c, r, lang) || "—"}
                      </Link>
                    ) : (
                      displayValue(c, r, lang)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
          <span>
            {labels.records}: {result.total}
          </span>
          {pages > 1 && (
            <div className="flex items-center gap-3">
              {result.page > 1 && <Link href={href(base, { ...query, page: result.page - 1 })}>← {labels.previous}</Link>}
              <span>
                {result.page} / {pages}
              </span>
              {result.page < pages && <Link href={href(base, { ...query, page: result.page + 1 })}>{labels.next} →</Link>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
