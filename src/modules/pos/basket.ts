/**
 * Odložené nákupy („plovoucí pokladna“): rozpracovaný nákup pod boxem s QR
 * kódem nebo pod libovolným označením. Sdílí je všechny pokladny firmy —
 * nákup se skládá u váhy a zaplatí na kase. Ceny se počítají až při placení
 * (sale.ts); nákup drží jen položky a množství.
 */
import { UserError, type DataApi, type ObjectHandlers, type RecordData } from "@/core/module";

export interface BasketView {
  id: string;
  label: string;
  boxCode: string | null;
  version: number;
  updatedAt: string;
  lines: { itemId: string; qty: string }[];
}

async function view(data: DataApi, b: RecordData): Promise<BasketView> {
  const lines = await data.find("pos.basketLine", { basketId: b.id }, { take: 500, orderBy: { lineNum: "asc" } });
  const box = b.boxId ? await data.get("pos.box", String(b.boxId)) : null;
  return {
    id: String(b.id),
    label: String(b.label),
    boxCode: box ? String(box.code) : null,
    version: Number(b.version),
    updatedAt: String(b.updatedAt ?? ""),
    lines: lines.map((l) => ({ itemId: String(l.itemId), qty: String(l.qty) })),
  };
}

/** Otevřené nákupy firmy (nejstarší první). */
export async function openBaskets(data: DataApi): Promise<BasketView[]> {
  const rows = await data.find("pos.basket", { status: "open" }, { take: 200, orderBy: { createdAt: "asc" } });
  return Promise.all(rows.map((b) => view(data, b)));
}

/** Box podle kódu (QR nebo ručně napsaný); null = není to kód boxu. */
export async function boxByCode(data: DataApi, code: string): Promise<RecordData | null> {
  const c = code.trim().toUpperCase();
  if (!c || c.length > 20) return null;
  const [box] = await data.find("pos.box", { code: c, active: true }, { take: 1 });
  return box ?? null;
}

/** Otevřený nákup boxu; když box žádný nemá, založí prázdný. */
export async function basketForBox(data: DataApi, box: RecordData, registerId: string): Promise<BasketView> {
  const [open] = await data.find("pos.basket", { boxId: box.id, status: "open" }, { take: 1 });
  if (open) return view(data, open);
  const b = await data.create("pos.basket", { label: String(box.name || box.code), boxId: box.id, registerId, status: "open" });
  return view(data, b);
}

/**
 * Uloží nákup (položky nahradí). `version` = verze, kterou terminál zná —
 * když nákup mezitím změnil jiný terminál, hlásí konflikt (terminál ho načte znovu).
 */
export async function saveBasket(
  data: DataApi,
  input: { id?: string | null; label?: string | null; boxCode?: string | null; registerId: string; version?: number; lines: { itemId: string; qty: string }[] },
): Promise<BasketView> {
  if (input.lines.length > 500) throw new UserError("@POS:InvalidQty");
  let basket: RecordData;
  if (input.id) {
    const cur = await data.get("pos.basket", input.id);
    if (!cur || cur.status !== "open") throw new UserError("@POS:BasketClosed");
    if (input.version !== undefined && Number(cur.version) !== input.version) throw new UserError("@POS:BasketChanged");
    // zápis hlavičky zvýší verzi (souběžné úpravy)
    basket = await data.update("pos.basket", input.id, { registerId: input.registerId });
  } else {
    const box = input.boxCode ? await boxByCode(data, input.boxCode) : null;
    if (box) {
      const [busy] = await data.find("pos.basket", { boxId: box.id, status: "open" }, { take: 1 });
      if (busy) throw new UserError("@POS:BoxBusy", { box: String(box.code) });
    }
    const label = box ? String(box.name || box.code) : String(input.label ?? "").trim();
    if (!label) throw new UserError("@SYS:FixErrors", {}, { label: "@SYS:Required" });
    // jméno zákazníka: dva rozpracované nákupy pod stejným označením by se pletly
    if (!box && (await data.find("pos.basket", { status: "open", label }, { take: 1 })).length) throw new UserError("@POS:BoxBusy", { box: label });
    basket = await data.create("pos.basket", { label, boxId: box?.id ?? null, registerId: input.registerId, status: "open" });
  }
  for (const l of await data.find("pos.basketLine", { basketId: basket.id }, { take: 1000 })) await data.remove("pos.basketLine", String(l.id));
  let n = 0;
  for (const l of input.lines) {
    if (!(Number(l.qty) > 0)) continue;
    await data.create("pos.basketLine", { basketId: basket.id, lineNum: ++n, itemId: l.itemId, qty: l.qty });
  }
  return view(data, (await data.get("pos.basket", String(basket.id)))!);
}

/** Uzavře nákup: zaplaceno (s účtenkou) nebo zrušeno. Box je pak volný. */
export async function closeBasket(data: DataApi, id: string, status: "paid" | "cancelled", receiptId: string | null = null) {
  const b = await data.get("pos.basket", id);
  if (!b || b.status !== "open") throw new UserError("@POS:BasketClosed");
  await data.update("pos.basket", id, { status, receiptId });
}

export const basketHandlers: Record<string, ObjectHandlers> = {
  "pos.box": {
    beforeSave(_ctx, d) {
      // kód boxu = obsah QR; jen písmena a číslice (čtečka s českou klávesnicí mění symboly)
      if (d.code && !/^[A-Z0-9-]+$/.test(String(d.code))) return { code: "@POS:BoxCodeFormat" };
    },
  },
};
