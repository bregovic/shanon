"use client";

/** Správa uživatelů tenanta: seznam + šuplík (stejný vzor jako u objektů). */
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
  tokens,
} from "@fluentui/react-components";
import { Add24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { saveUserAction, type UserInput } from "@/app/actions";
import { ActionBar, Crumbs, PageContent, Spacer } from "./page";
import { useShortcuts } from "./shortcuts";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lang: string;
  roleIds: string[];
}

type Labels = Record<
  "new" | "edit" | "save" | "cancel" | "close" | "name" | "email" | "admin" | "administrator" | "active" | "lang" | "roles" | "password" | "passwordHelp" | "user",
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
});

const empty: UserInput = { id: null, name: "", email: "", admin: false, active: true, lang: "cs", roleIds: [], password: "" };

export function UsersView({
  crumbs,
  users,
  roles,
  labels,
}: {
  crumbs: { label: string; href?: string }[];
  users: User[];
  roles: { id: string; label: string }[];
  labels: Labels;
}) {
  const s = useStyles();
  const router = useRouter();
  const [edit, setEdit] = useState<UserInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [busy, start] = useTransition();
  const roleName = (id: string) => roles.find((r) => r.id === id)?.label ?? "";

  const open = (u: User | null) => {
    setErrors({});
    setMessage(undefined);
    setEdit(
      u
        ? { id: u.id, name: u.name, email: u.email, admin: u.role === "admin", active: u.active, lang: u.lang, roleIds: u.roleIds, password: "" }
        : { ...empty },
    );
  };
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
                <TableHeaderCell>{labels.roles}</TableHeaderCell>
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
                    {u.role === "admin" ? (
                      <Badge appearance="tint" color="brand">
                        {labels.administrator}
                      </Badge>
                    ) : (
                      u.roleIds.map(roleName).join(", ")
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
                {edit.id ? edit.name : `${labels.new} · ${labels.user}`}
              </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody>
              <div className={s.form}>
                {message && (
                  <MessageBar intent="error">
                    <MessageBarBody>{message}</MessageBarBody>
                  </MessageBar>
                )}
                <Field label={labels.name} required validationMessage={errors.name}>
                  <Input value={edit.name} onChange={(_, d) => setEdit({ ...edit, name: d.value })} />
                </Field>
                <Field label={labels.email} required validationMessage={errors.email}>
                  <Input type="email" value={edit.email} onChange={(_, d) => setEdit({ ...edit, email: d.value })} />
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
                <Switch label={labels.admin} checked={edit.admin} onChange={(_, d) => setEdit({ ...edit, admin: d.checked })} />
                {!edit.admin && (
                  <Field label={labels.roles}>
                    {roles.map((r) => (
                      <Checkbox
                        key={r.id}
                        label={r.label}
                        checked={edit.roleIds.includes(r.id)}
                        onChange={(_, d) =>
                          setEdit({ ...edit, roleIds: d.checked ? [...edit.roleIds, r.id] : edit.roleIds.filter((x) => x !== r.id) })
                        }
                      />
                    ))}
                  </Field>
                )}
                <Field label={labels.password} required={!edit.id} hint={labels.passwordHelp} validationMessage={errors.password}>
                  <Input type="password" autoComplete="new-password" value={edit.password ?? ""} onChange={(_, d) => setEdit({ ...edit, password: d.value })} />
                </Field>
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
