import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { registry } from "@/registry";
import { helpFor, helpTopics, renderMarkdown } from "@/server/help";

describe("nápověda", () => {
  it("návody mají název, shrnutí a existující modul i objekty", () => {
    const topics = helpTopics();
    expect(topics.length).toBeGreaterThanOrEqual(10);
    for (const t of topics) {
      expect(t.title && t.summary, t.id).toBeTruthy();
      if (t.module !== "general") expect(registry.modules.has(t.module), `${t.id}: modul ${t.module}`).toBe(true);
      for (const o of t.objects) expect(registry.objects.has(o), `${t.id}: objekt ${o}`).toBe(true);
    }
  });
  it("návod k objektu i modulu", () => {
    expect(helpFor("ar.invoice")?.id).toBe("faktura-vydana");
    expect(helpFor("whs")?.id).toBe("sklad");
  });
  it("Markdown: kroky, tabulka, tip, bezpečné odkazy a escapování", () => {
    const h = renderMarkdown("## Krok\n\n1. **Nový** v [Faktury](/ar/invoice)\n2. druhý\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> tip\n\n<script>x</script> [zlý](javascript:alert(1))");
    expect(h).toContain("<h3>Krok</h3>");
    expect(h).toContain('<ol><li><strong>Nový</strong> v <a href="/ar/invoice">Faktury</a></li><li>druhý</li></ol>');
    expect(h).toContain("<td>2</td>");
    expect(h).toContain("<blockquote>tip</blockquote>");
    expect(h).not.toContain("<script>");
    expect(h).toContain('href="#"');
  });
});
