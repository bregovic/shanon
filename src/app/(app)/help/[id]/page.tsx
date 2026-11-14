import { notFound } from "next/navigation";
import { HelpArticle } from "@/components/help-view";
import { requireSession } from "@/server/auth";
import { helpTopic, renderMarkdown } from "@/server/help";
import { getT } from "@/server/i18n";

export default async function HelpTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const t = await getT(s.lang, s.ctx.tenantId);
  const topic = helpTopic(id);
  if (!topic) notFound();
  return <HelpArticle crumbs={[{ label: t("@SYS:Help"), href: "/help" }]} title={topic.title} html={renderMarkdown(topic.body)} />;
}
