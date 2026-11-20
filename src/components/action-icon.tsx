/**
 * Ikona tlačítka akce záznamu: `actions[].icon`, jinak podle id akce (zaúčtovat, schválit, odeslat…),
 * jinak blesk (spustit funkci). Jedno místo pro detail, seznam i hromadné akce.
 */
import type { ReactElement } from "react";
import {
  ArrowDownload24Regular,
  ArrowSync24Regular,
  ArrowUndo24Regular,
  ArrowUpload24Regular,
  BoxCheckmark24Regular,
  Calculator24Regular,
  CalendarLtr24Regular,
  CheckmarkCircle24Regular,
  ClipboardTaskListLtr24Regular,
  Copy24Regular,
  DismissCircle24Regular,
  DocumentArrowRight24Regular,
  DocumentCheckmark24Regular,
  Flash24Regular,
  Key24Regular,
  Link24Regular,
  LockClosed24Regular,
  Mail24Regular,
  Money24Regular,
  Open24Regular,
  PersonAdd24Regular,
  PlugConnected24Regular,
  Print24Regular,
  ScanText24Regular,
  Send24Regular,
  VehicleTruckProfile24Regular,
} from "@fluentui/react-icons";
import type { ActionIcon as IconName } from "@/core/object";

const ICONS: Record<IconName, () => ReactElement> = {
  post: () => <DocumentCheckmark24Regular />,
  unpost: () => <ArrowUndo24Regular />,
  approve: () => <CheckmarkCircle24Regular />,
  done: () => <CheckmarkCircle24Regular />,
  reject: () => <DismissCircle24Regular />,
  cancel: () => <DismissCircle24Regular />,
  send: () => <Send24Regular />,
  mail: () => <Mail24Regular />,
  list: () => <DocumentArrowRight24Regular />,
  scan: () => <ScanText24Regular />,
  check: () => <ClipboardTaskListLtr24Regular />,
  partner: () => <PersonAdd24Regular />,
  open: () => <Open24Regular />,
  refresh: () => <ArrowSync24Regular />,
  calc: () => <Calculator24Regular />,
  money: () => <Money24Regular />,
  link: () => <Link24Regular />,
  key: () => <Key24Regular />,
  test: () => <PlugConnected24Regular />,
  copy: () => <Copy24Regular />,
  stock: () => <BoxCheckmark24Regular />,
  upload: () => <ArrowUpload24Regular />,
  print: () => <Print24Regular />,
  run: () => <Flash24Regular />,
};

/** výchozí ikona podle id akce (stejná akce = stejná ikona ve všech modulech) */
const BY_ID: Record<string, IconName> = {
  post: "post",
  postPayment: "money",
  unpost: "unpost",
  approve: "approve",
  confirm: "approve",
  validate: "check",
  done: "done",
  reject: "reject",
  cancel: "cancel",
  discard: "cancel",
  close: "cancel",
  send: "send",
  email: "mail",
  list: "list",
  createInvoice: "list",
  createAdvance: "list",
  createJournal: "list",
  createIssue: "list",
  extract: "scan",
  check: "check",
  recheck: "check",
  vatCheck: "check",
  match: "link",
  suggest: "calc",
  calculate: "calc",
  simplifyVat: "calc",
  createPartner: "partner",
  createVendor: "partner",
  createCustomer: "partner",
  createSubjectValues: "partner",
  openRecord: "open",
  ares: "refresh",
  cnb: "refresh",
  ecb: "refresh",
  pair: "test",
  test: "test",
  token: "key",
  newToken: "key",
  receive: "stock",
  loadOnhand: "stock",
  periods: "calc",
  import: "upload",
  uploadCert: "upload",
  detach: "link",
  run: "run",
};

const SPECIAL: Record<string, () => ReactElement> = {
  ship: () => <VehicleTruckProfile24Regular />,
  periods: () => <CalendarLtr24Regular />,
  close: () => <LockClosed24Regular />,
};

export function actionIcon(a: { id: string; icon?: IconName; download?: boolean; upload?: string }): ReactElement {
  if (a.icon) return ICONS[a.icon]();
  if (SPECIAL[a.id]) return SPECIAL[a.id]();
  const by = BY_ID[a.id];
  if (by) return ICONS[by]();
  if (a.download) return <ArrowDownload24Regular />;
  if (a.upload) return <ArrowUpload24Regular />;
  return ICONS.run();
}
