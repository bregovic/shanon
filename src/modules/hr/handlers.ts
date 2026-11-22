/** Zaměstnanci — dopočet celého jména z jména a příjmení. */
import type { ObjectHandlers } from "@/core/module";
import { employeeVendor } from "@/modules/int/documents";

export const hrHandlers: Record<string, ObjectHandlers> = {
  "hr.employee": {
    beforeSave(_ctx, d) {
      d.name = [d.firstName, d.lastName].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ").slice(0, 120);
      if (d.validFrom && d.validTo && String(d.validTo) < String(d.validFrom)) return { validTo: "@SYS:InvalidValue" };
    },
    actions: {
      // osoba v adresáři + dodavatel s účtovacím profilem ZAM, přiřazený zaměstnanci
      async createVendor(ctx, emp) {
        await employeeVendor(ctx.data, String(emp.id));
      },
    },
  },
};
