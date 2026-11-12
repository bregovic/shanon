"use client";

/**
 * Hlavička aplikace — převzatá ze staré verze: logo, výběr modulu,
 * přepínač firmy, nastavení, uživatel, odhlášení.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Avatar,
  Button,
  makeStyles,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import { Building24Regular, Checkmark24Regular, Home24Regular, Settings24Regular, SignOut24Regular } from "@fluentui/react-icons";
import { logoutAction, switchCompanyAction } from "@/app/actions";
import { ModuleIcon } from "./icons";

export interface ShellModule {
  id: string;
  label: string;
  icon: string;
  href: string;
}

interface Props {
  modules: ShellModule[];
  companies: { id: string; code: string; name: string }[];
  companyId: string | null;
  user: { name: string; email: string; initials: string; admin: boolean };
  labels: { home: string; settings: string; signOut: string };
  children: React.ReactNode;
}

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minHeight: "100vh" },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    gap: "16px",
    height: "56px",
    padding: "0 16px",
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  logo: { display: "flex", alignItems: "center", flexShrink: 0 },
  spacer: { flex: 1, minWidth: "16px" },
  right: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
  divider: { width: "1px", height: "20px", backgroundColor: tokens.colorNeutralStroke2, margin: "0 8px" },
  content: { flex: 1, display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground2 },
  muted: { color: tokens.colorNeutralForeground3, marginLeft: "8px" },
});

export function AppShell({ modules, companies, companyId, user, labels, children }: Props) {
  const s = useStyles();
  const path = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const current = modules.find((m) => path === m.href || path.startsWith(`${m.href}/`));
  const company = companies.find((c) => c.id === companyId);

  const switchCompany = (id: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("companyId", id);
      await switchCompanyAction(fd);
      router.refresh();
    });

  return (
    <div className={s.root}>
      <header className={s.header}>
        <Link href={current?.href ?? "/"} className={s.logo} aria-label="Shanon">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-header.png" alt="Shanon" height={28} />
        </Link>

        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="subtle" icon={current ? <ModuleIcon name={current.icon} /> : <Home24Regular />} style={{ fontWeight: 600 }}>
              {current?.label ?? labels.home}
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<Home24Regular />} onClick={() => router.push("/")}>
                {labels.home}
              </MenuItem>
              {modules.map((m) => (
                <MenuItem
                  key={m.id}
                  icon={<ModuleIcon name={m.icon} />}
                  secondaryContent={current?.id === m.id ? <Checkmark24Regular /> : undefined}
                  onClick={() => router.push(m.href)}
                >
                  <span style={{ fontWeight: current?.id === m.id ? 600 : 400 }}>{m.label}</span>
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>

        <div className={s.spacer} />

        <div className={s.right}>
          {companies.length > 0 && (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button appearance="subtle" icon={<Building24Regular />} style={{ fontWeight: 600 }}>
                  {company?.code ?? "—"}
                </Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {companies.map((c) => (
                    <MenuItem
                      key={c.id}
                      icon={c.id === companyId ? <Checkmark24Regular /> : <span style={{ width: 24 }} />}
                      onClick={() => switchCompany(c.id)}
                    >
                      <span style={{ fontWeight: c.id === companyId ? 600 : 400 }}>{c.code}</span>
                      <span className={s.muted}>{c.name}</span>
                    </MenuItem>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          )}

          <div className={s.divider} />

          {user.admin && (
            <Tooltip content={labels.settings} relationship="label">
              <Button appearance="subtle" icon={<Settings24Regular />} onClick={() => router.push("/system/modules")} />
            </Tooltip>
          )}

          <Tooltip content={`${user.name} · ${user.email}`} relationship="label">
            <Avatar color="brand" initials={user.initials} size={32} style={{ margin: "0 8px" }} />
          </Tooltip>

          <Tooltip content={labels.signOut} relationship="label">
            <Button appearance="subtle" icon={<SignOut24Regular />} onClick={() => start(() => logoutAction())} />
          </Tooltip>
        </div>
      </header>
      <main className={s.content}>{children}</main>
    </div>
  );
}
