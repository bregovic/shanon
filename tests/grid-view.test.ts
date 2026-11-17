/** Zapamatované filtry seznamu platí jen v rámci agendy (seznam + detail záznamu). */
import { describe, expect, it } from "vitest";
import { dropStaleGridViews } from "@/lib/grid-view";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()].sort(),
  };
}

describe("filtry seznamu", () => {
  it("návrat z detailu filtr zachová, jiná agenda ho zahodí", () => {
    const st = fakeStorage();
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = st;
    st.setItem("grid:inv.item", JSON.stringify({ filters: { eshop: "ano" }, base: "/inv/item" }));
    st.setItem("grid:ar.invoice", JSON.stringify({ filters: { status: "posted" }, base: "/ar/invoice" }));
    st.setItem("grid:old", JSON.stringify({ filters: {} }));
    st.setItem("other", "x");
    dropStaleGridViews("/inv/item/123");
    expect(st.keys()).toEqual(["grid:inv.item", "other"]);
    dropStaleGridViews("/inv/item");
    expect(st.keys()).toEqual(["grid:inv.item", "other"]);
    dropStaleGridViews("/inv/itemGroup");
    expect(st.keys()).toEqual(["other"]);
  });
});
