"use client";

/** Náhled dokladu: zápisy HK a DPH, které by vznikly zaúčtováním (nic se nezapíše). */
import { useEffect, useState } from "react";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { previewPostingAction } from "@/app/actions";
import type { PostingPreview } from "@/server/posting-preview";

export interface PostingLabels {
  preview: string;
  title: string;
  hint: string;
  empty: string;
  tax: string;
  account: string;
  debit: string;
  credit: string;
  text: string;
  taxCode: string;
  base: string;
  taxAmount: string;
  close: string;
}

const useStyles = makeStyles({
  num: { textAlign: "right", whiteSpace: "nowrap" },
  head: { marginTop: "16px", marginBottom: "4px", fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  total: { fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground2 },
});

export function PostingPreviewDrawer({ objectId, id, open, onClose, labels, lang }: { objectId: string; id: string; open: boolean; onClose: () => void; labels: PostingLabels; lang: string }) {
  const s = useStyles();
  const [data, setData] = useState<PostingPreview | null>(null);
  const [error, setError] = useState<string>();
  const nf = new Intl.NumberFormat(lang === "en" ? "en-GB" : "cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (v: string | null) => (v === null ? "" : nf.format(Number(v)));

  useEffect(() => {
    if (!open) return;
    let alive = true;
    previewPostingAction(objectId, id).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setData(r.data);
        setError(undefined);
      } else setError(r.message);
    });
    return () => {
      alive = false;
      setData(null);
      setError(undefined);
    };
  }, [open, objectId, id]);

  return (
    <Drawer type="overlay" position="end" size="large" open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={labels.close} icon={<Dismiss24Regular />} onClick={onClose} />}>{labels.title}</DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {error ? (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        ) : !data ? (
          <Spinner />
        ) : (
          <>
            <Text className={s.muted}>{labels.hint}</Text>
            {!data.vouchers.length && <Text block>{labels.empty}</Text>}
            {data.vouchers.map((v) => {
              const d = v.lines.reduce((a, l) => a + Number(l.debit ?? 0), 0);
              const c = v.lines.reduce((a, l) => a + Number(l.credit ?? 0), 0);
              return (
                <div key={v.voucherNum + v.date}>
                  <Text block className={s.head}>
                    {v.voucherNum} · {v.date.split("-").reverse().join(". ").replace(/^0/, "")}
                  </Text>
                  <Table size="small">
                    <TableHeader>
                      <TableRow>
                        <TableHeaderCell>{labels.account}</TableHeaderCell>
                        <TableHeaderCell>{labels.text}</TableHeaderCell>
                        <TableHeaderCell className={s.num}>{labels.debit}</TableHeaderCell>
                        <TableHeaderCell className={s.num}>{labels.credit}</TableHeaderCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {v.lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell>{l.account}</TableCell>
                          <TableCell>{l.text}</TableCell>
                          <TableCell className={s.num}>{fmt(l.debit)}</TableCell>
                          <TableCell className={s.num}>{fmt(l.credit)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className={s.total}>
                        <TableCell />
                        <TableCell />
                        <TableCell className={s.num}>{nf.format(d)}</TableCell>
                        <TableCell className={s.num}>{nf.format(c)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })}
            {data.tax.length > 0 && (
              <>
                <Text block className={s.head}>
                  {labels.tax}
                </Text>
                <Table size="small">
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell>{labels.taxCode}</TableHeaderCell>
                      <TableHeaderCell className={s.num}>{labels.base}</TableHeaderCell>
                      <TableHeaderCell className={s.num}>{labels.taxAmount}</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.tax.map((x, i) => (
                      <TableRow key={i}>
                        <TableCell>{x.code}</TableCell>
                        <TableCell className={s.num}>{fmt(x.base)}</TableCell>
                        <TableCell className={s.num}>{fmt(x.tax)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </>
        )}
      </DrawerBody>
    </Drawer>
  );
}
