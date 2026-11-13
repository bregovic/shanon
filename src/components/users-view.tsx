"use client";

/**
 * Správa uživatelů: superuživatel všechny, správce firmy jen uživatele
 * svých firem. U každé firmy: přístup, správce firmy, role.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Dropdown,
  Field,
  Input,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Option,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  tokens,
} from "@fluentui/react-components";
import { Add24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { saveUserAction, type UserCompanyInput, type UserInput } from "@/app/actions";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";
import { useShortcuts } from "./shortcuts";

interface User {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  superUser: boolean;
  active: boolean;
  lang: string;
  companies: UserCompanyInput[];
  companyCodes: string;
}

type Labels = Record<
  | "new"
  | "save"
  | "cancel"
  | "close"
  | "name"
  | "firstName"
  | "lastName"
  | "newPassword"
  | "email"
  | "superUser"
  | "active"
  | "lang"
  | "roles"
  | "companies"
  | "userCompanies"
  | "access"
  | "companyAdmin"
  | "password"
  | "passwordHelp"
  | "user"
  | "general",
  string
>;

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflowX: "auto",
  },
  row: { cursor: "pointer" },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  section: {
    fontWeight: tokens.fontWeightSemibold,
    paddingBottom: "6px",
    marginTop: "8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  company: {
    padding: "8px 12px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  roles: { display: "flex", flexDirection: "column", paddingLeft: "28px" },
});

export function UsersView({
  crumbs,
  canSuper,
  users,
  companies,
  roles,
  labels,
}: {
  crumbs: { label: string; href?: string }[];
  /** editor je superuživatel (smí dělat superuživatele) */
  canSuper: boolean;
  users: User[];
  /** firmy, ve kterých editor smí přiřazovat */
  companies: { id: string; label: string }[];
  roles: { id: string; label: string }[];
  labels: Labels;
}) {
  const s = useStyles();
  const router = useRouter();
  const [edit, setEdit] = useState<UserInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [busy, start] = useTransition();

  const open = (u: User | null) => {
    setErrors({});
    setMessage(undefined);
    setEdit(
      u
        ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, superUser: u.superUser, active: u.active, lang: u.lang, companies: u.companies, password: "" }
        : { id: null, firstName: "", lastName: "", email: "", superUser: false, active: true, lang: "cs", password: "", companies: [] },
    );
  };
  const assignment = (companyId: string) => edit?.companies.find((a) => a.companyId === companyId);
  const setAssignment = (companyId: string, a: UserCompanyInput | null) =>
    edit &&
    setEdit({
      ...edit,
      companies: [...edit.companies.filter((x) => x.companyId !== companyId), ...(a ? [a] : [])],
    });

  const save = () =>
    start(async () => {
      if (!edit) return;
      const res = await saveUserAction(edit);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.message);
        return;
      }
      setEdit(null);
      router.refresh();
    });
  useShortcuts({ new: () => open(null) }, !edit);
  useShortcuts({ save }, !!edit);

  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
        <Spacer />
        <Button appearance="primary" icon={<Add24Regular />} onClick={() => open(null)}>
          {labels.new}
        </Button>
      </ActionBar>
      <PageContent>
        <div className={s.card}>
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{labels.name}</TableHeaderCell>
                <TableHeaderCell>{labels.email}</TableHeaderCell>
                <TableHeaderCell>{labels.companies}</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "center" }}>{labels.active}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={s.row} onDoubleClick={() => open(u)} onKeyDown={(e) => e.key === "Enter" && open(u)} tabIndex={0}>
                  <TableCell>
                    <strong>{u.name}</strong>
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    {u.superUser ? (
                      <Badge appearance="tint" color="brand">
                        {labels.superUser}
                      </Badge>
                    ) : (
                      u.companyCodes
                    )}
                  </TableCell>
                  <TableCell style={{ textAlign: "center" }}>{u.active ? "✓" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageContent>

      <Drawer type="overlay" position="end" size="medium" open={!!edit} onOpenChange={(_, d) => !d.open && setEdit(null)}>
        {edit && (
          <>
            <DrawerHeader>
              <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={labels.close} icon={<Dismiss24Regular />} onClick={() => setEdit(null)} />}>
                {edit.id ? `${edit.firstName} ${edit.lastName}`.trim() : `${labels.new} · ${labels.user}`}
              </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody>
              <div className={s.form}>
                {message && (
                  <MessageBar intent="error">
                    <MessageBarBody>{message}</MessageBarBody>
                  </MessageBar>
                )}
                <div className={s.section}>{labels.general}</div>
                <Field label={labels.firstName} required validationMessage={errors.firstName}>
                  <Input value={edit.firstName} autoComplete="given-name" onChange={(_, d) => setEdit({ ...edit, firstName: d.value })} />
                </Field>
                <Field label={labels.lastName} required validationMessage={errors.lastName}>
                  <Input value={edit.lastName} autoComplete="family-name" onChange={(_, d) => setEdit({ ...edit, lastName: d.value })} />
                </Field>
                <Field label={labels.email} required validationMessage={errors.email}>
                  <Input type="email" autoComplete="username" value={edit.email} onChange={(_, d) => setEdit({ ...edit, email: d.value })} />
                </Field>
                <Field label={labels.lang}>
                  <Dropdown
                    value={edit.lang === "en" ? "English" : "Čeština"}
                    selectedOptions={[edit.lang]}
                    onOptionSelect={(_, d) => setEdit({ ...edit, lang: d.optionValue ?? "cs" })}
                  >
                    <Option value="cs">Čeština</Option>
                    <Option value="en">English</Option>
                  </Dropdown>
                </Field>
                <Switch label={labels.active} checked={edit.active} onChange={(_, d) => setEdit({ ...edit, active: d.checked })} />
                <Field label={edit.id ? labels.password : labels.newPassword} required={!edit.id} hint={labels.passwordHelp} validationMessage={errors.password}>
                  <Input type="password" autoComplete="new-password" value={edit.password ?? ""} onChange={(_, d) => setEdit({ ...edit, password: d.value })} />
                </Field>

                {canSuper && (
                  <Switch label={labels.superUser} checked={edit.superUser} onChange={(_, d) => setEdit({ ...edit, superUser: d.checked })} />
                )}

                {!edit.superUser && (
                  <>
                    <div className={s.section}>{labels.userCompanies}</div>
                    {companies.map((c) => {
                      const a = assignment(c.id);
                      return (
                        <div key={c.id} className={s.company}>
                          <Checkbox
                            label={<Text weight="semibold">{c.label}</Text>}
                            checked={!!a}
                            onChange={(_, d) => setAssignment(c.id, d.checked ? { companyId: c.id, admin: false, roleIds: [] } : null)}
                          />
                          {a && (
                            <div className={s.roles}>
                              <Switch label={labels.companyAdmin} checked={a.admin} onChange={(_, d) => setAssignment(c.id, { ...a, admin: d.checked })} />
                              {!a.admin &&
                                roles.map((r) => (
                                  <Checkbox
                                    key={r.id}
                                    label={r.label}
                                    checked={a.roleIds.includes(r.id)}
                                    onChange={(_, d) =>
                                      setAssignment(c.id, {
                                        ...a,
                                        roleIds: d.checked ? [...a.roleIds, r.id] : a.roleIds.filter((x) => x !== r.id),
                                      })
                                    }
                                  />
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </DrawerBody>
            <DrawerFooter>
              <Button onClick={() => setEdit(null)}>{labels.cancel}</Button>
              <span style={{ flex: 1 }} />
              <Button appearance="primary" disabled={busy} onClick={save}>
                {labels.save}
              </Button>
            </DrawerFooter>
          </>
        )}
      </Drawer>
    </>
  );
}
