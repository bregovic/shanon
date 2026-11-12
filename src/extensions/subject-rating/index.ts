/**
 * Ukázkové veřejné rozšíření: hodnocení subjektu.
 * Přidává pole do gab.subject bez změny core (ukládá se do `ext`)
 * a vlastní validaci přes událost beforeSave.
 */
import { defineEdt } from "@/core/edt";
import { defineExtension } from "@/core/module";

const Rating = defineEdt({ id: "SubjectRating", kind: "int", label: "@XRATING:Rating", align: "right" });

export default defineExtension({
  id: "subject-rating",
  label: "@XRATING:Name",
  description: "@XRATING:Desc",
  visibility: "public",
  owner: "core",
  dependsOn: ["gab"],
  labelPrefix: "XRATING",
  fields: {
    "gab.subject": {
      rating: { edt: Rating },
      ratingNote: { edt: { id: "SubjectRatingNote", kind: "string", label: "@XRATING:Note", maxLength: 255 } },
    },
  },
  handlers: {
    "gab.subject": {
      beforeSave(_ctx, data) {
        const r = data.ext && (data.ext as Record<string, unknown>).rating;
        if (r !== null && r !== undefined && (Number(r) < 1 || Number(r) > 5)) return { rating: "@XRATING:Range" };
      },
    },
  },
  labels: {
    cs: {
      Name: "Hodnocení subjektu",
      Desc: "Hodnocení 1–5 a poznámka u odběratelů a dodavatelů.",
      Rating: "Hodnocení",
      Note: "Poznámka k hodnocení",
      Range: "Hodnocení je 1 až 5.",
    },
    en: {
      Name: "Party rating",
      Desc: "Rating 1–5 and a note for customers and vendors.",
      Rating: "Rating",
      Note: "Rating note",
      Range: "Rating must be 1 to 5.",
    },
  },
});
