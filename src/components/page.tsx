"use client";

/** Rozložení stránky ze staré verze: ActionBar nahoře, obsah pod ním. */
import { useRouter } from "next/navigation";
import { Breadcrumb, BreadcrumbButton, BreadcrumbDivider, BreadcrumbItem, makeStyles, tokens } from "@fluentui/react-components";
import { Fragment } from "react";

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "44px",
    padding: "6px 24px",
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowX: "auto",
    scrollbarWidth: "none",
    whiteSpace: "nowrap",
    "@media (max-width: 768px)": { padding: "6px 12px" },
  },
  content: {
    flex: 1,
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    minHeight: 0,
    "@media (max-width: 768px)": { padding: "12px", gap: "12px" },
  },
  spacer: { flex: 1 },
});

export function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className={useStyles().bar}>{children}</div>;
}

export function Spacer() {
  return <div className={useStyles().spacer} />;
}

export function PageContent({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className={useStyles().content} style={style}>
      {children}
    </div>
  );
}

/** Drobečková navigace: poslední položka je aktuální stránka. */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  const router = useRouter();
  return (
    <Breadcrumb size="medium">
      {items.map((it, i) => (
        <Fragment key={i}>
          <BreadcrumbItem>
            {it.href && i < items.length - 1 ? (
              <BreadcrumbButton onClick={() => router.push(it.href!)}>{it.label}</BreadcrumbButton>
            ) : (
              <BreadcrumbButton current={i === items.length - 1}>{it.label}</BreadcrumbButton>
            )}
          </BreadcrumbItem>
          {i < items.length - 1 && <BreadcrumbDivider />}
        </Fragment>
      ))}
    </Breadcrumb>
  );
}
