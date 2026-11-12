"use client";

import { useRouter } from "next/navigation";
import { Card, CardHeader, makeStyles, Text, tokens } from "@fluentui/react-components";
import { ModuleIcon } from "./icons";
import { ActionBar, Crumbs, PageContent } from "./page";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" },
  icon: {
    display: "grid",
    placeItems: "center",
    width: "40px",
    height: "40px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
});

export function HomeTiles({
  title,
  modules,
}: {
  title: string;
  modules: { id: string; label: string; description: string; icon: string }[];
}) {
  const s = useStyles();
  const router = useRouter();
  return (
    <>
      <ActionBar>
        <Crumbs items={[{ label: title }]} />
      </ActionBar>
      <PageContent>
        <div className={s.grid}>
          {modules.map((m) => (
            <Card key={m.id} onClick={() => router.push(`/${m.id}`)} style={{ cursor: "pointer" }}>
              <CardHeader
                image={
                  <div className={s.icon}>
                    <ModuleIcon name={m.icon} />
                  </div>
                }
                header={<Text weight="semibold">{m.label}</Text>}
                description={<Text size={200}>{m.description}</Text>}
              />
            </Card>
          ))}
        </div>
      </PageContent>
    </>
  );
}
