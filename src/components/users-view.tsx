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
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
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
import { Add24Regular, Delete24Regular, Dismiss24Regular, Edit24Regular } from "@fluentui/react-icons";
import { deleteUserAction, saveUserAction, sendUserMailAction, type UserCompanyInput, type UserInput } from "@/app/actions";
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
  /** pozvánka odešla, heslo si zatím nenastavil */
  invited: boolean;
}

type Labels = Record<
  | "new"
  | "edit"
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
  | "general"
  | "delete"
  | "deleteConfirm"
  | "sendInvite"
  | "sendInviteHint"
  | "inviteAgain"
  | "resetPassword"
  | "resetConfirm"
  | "inviteSent"
  | "resetSent"
  | "mailNotConfigured"
  | "invited",
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
  const [selected, setSelected] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [info, setInfo] = useState<{ intent: "success" | "warning"; text: string }>();
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, start] = useTransition();

  const open = (u: User | null) => {
    setErrors({});
    setMessage(undefined);
    setEdit(
      u
        ? { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, superUser: u.superUser, active: u.active, lang: u.lang, companies: u.companies, password: "" }
        : { id: null, firstName: "", lastName: "", email: "", superUser: false, active: true, lang: "cs", password: "", sendInvite: true, companies: [] },
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
      // nový uživatel s pozvánkou: říct, jestli e-mail odešel
      if (!edit.id && edit.sendInvite && !edit.password)
        setInfo(res.data?.mailed ? { intent: "success", text: labels.inviteSent.replace("{email}", edit.email.trim()) } : { intent: "warning", text: res.data?.mailError ?? labels.mailNotConfigured });
      else setInfo(undefined);
      setEdit(null);
      router.refresh();
    });
  /** pozvánka znovu / reset hesla — odkaz e-mailem */
  const sendMail = (kind: "invite" | "reset") =>
    start(async () => {
      if (!edit?.id) return;
      setConfirmReset(false);
      const res = await sendUserMailAction(edit.id, kind);
      if (!res.ok) return setMessage(res.message);
      setInfo(res.data.mailed ? { intent: "success", text: (kind === "invite" ? labels.inviteSent : labels.resetSent).replace("{email}", edit.email) } : { intent: "warning", text: labels.mailNotConfigured });
      setEdit(null);
      router.refresh();
    });
  useShortcuts({ new: () => open(null) }, !edit);
  useShortcuts({ save }, !!edit);
  const [confirmDel, setConfirmDel] = useState<User | null>(null);
  const [delMsg, setDelMsg] = useState<string>();
  const remove = () =>
    start(async () => {
      if (!confirmDel) return;
      const res = await deleteUserAction(confirmDel.id);
      if (!res.ok) return setDelMsg(res.message);
      setConfirmDel(null);
      setDelMsg(undefined);
      router.refresh();
    });

  return (
    <>
      <ActionBar>
        <Crumbs items={crumbs} />
        <Spacer />
        <Button appearance="primary" icon={<Add24Regular />} onClick={() => open(null)}>
          {labels.new}
        </Button>
        <Button icon={<Edit24Regular />} disabled={!selected} onClick={() => open(users.find((u) => u.id === selected) ?? null)}>
          {labels.edit}
        </Button>
        <Button icon={<Delete24Regular />} disabled={!selected} onClick={() => (setDelMsg(undefined), setConfirmDel(users.find((u) => u.id === selected) ?? null))}>
          {labels.delete}
        </Button>
      </ActionBar>
      <Dialog open={!!confirmDel} onOpenChange={(_, d) => !d.open && setConfirmDel(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{labels.delete}</DialogTitle>
            <DialogContent>
              {delMsg && (
                <MessageBar intent="error" style={{ marginBottom: 8 }}>
                  <MessageBarBody>{delMsg}</MessageBarBody>
                </MessageBar>
              )}
              {labels.deleteConfirm.replace("{name}", confirmDel ? `${confirmDel.name} (${confirmDel.email})` : "")}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmDel(null)}>{labels.cancel}</Button>
              <Button appearance="primary" disabled={busy} onClick={remove}>
                {labels.delete}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <PageContent>
        {info && (
          <MessageBar intent={info.intent} style={{ marginBottom: 12 }}>
            <MessageBarBody>{info.text}</MessageBarBody>
          </MessageBar>
        )}
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
                <TableRow
                  key={u.id}
                  className={s.row}
                  aria-selected={selected === u.id}
                  style={selected === u.id ? { background: tokens.colorNeutralBackground1Selected } : undefined}
                  onClick={() => setSelected(u.id)}
                  onDoubleClick={() => open(u)}
                  onKeyDown={(e) => e.key === "Enter" && open(u)}
                  tabIndex={0}
                >
                  <TableCell>
                    {/* jméno = odkaz na úpravu (i na dotykovém displeji) */}
                    <Button appearance="transparent" size="small" style={{ padding: 0, minWidth: 0, fontWeight: 600 }} onClick={() => open(u)}>
                      {u.name}
                    </Button>
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
                  <TableCell style={{ textAlign: "center" }}>
                    {u.invited ? (
                      <Badge appearance="tint" color="warning">
                        {labels.invited}
                      </Badge>
                    ) : u.active ? (
                      "✓"
                    ) : (
                      ""
                    )}
                  </TableCell>
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
                {!edit.id && <Checkbox label={labels.sendInvite} checked={!!edit.sendInvite} onChange={(_, d) => setEdit({ ...edit, sendInvite: !!d.checked })} />}
                <Field
                  label={edit.id ? labels.password : labels.newPassword}
                  required={!edit.id && !edit.sendInvite}
                  hint={!edit.id && edit.sendInvite ? labels.sendInviteHint : labels.passwordHelp}
                  validationMessage={errors.password}
                >
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
            <DrawerFooter style={{ flexWrap: "wrap" }}>
              <Button onClick={() => setEdit(null)}>{labels.cancel}</Button>
              <span style={{ flex: 1 }} />
              {edit.id && users.find((u) => u.id === edit.id)?.invited && (
                <Button disabled={busy} onClick={() => sendMail("invite")}>
                  {labels.inviteAgain}
                </Button>
              )}
              {edit.id && (
                <Button disabled={busy} onClick={() => setConfirmReset(true)}>
                  {labels.resetPassword}
                </Button>
              )}
              <Button appearance="primary" disabled={busy} onClick={save}>
                {labels.save}
              </Button>
            </DrawerFooter>
          </>
        )}
      </Drawer>
      <Dialog open={confirmReset} onOpenChange={(_, d) => !d.open && setConfirmReset(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{labels.resetPassword}</DialogTitle>
            <DialogContent>{labels.resetConfirm.replace("{name}", edit ? `${edit.firstName} ${edit.lastName} (${edit.email})`.trim() : "")}</DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmReset(false)}>{labels.cancel}</Button>
              <Button appearance="primary" disabled={busy} onClick={() => sendMail("reset")}>
                {labels.resetPassword}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
