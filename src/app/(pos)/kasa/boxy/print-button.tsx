"use client";

import { Button } from "@fluentui/react-components";
import { Print24Regular } from "@fluentui/react-icons";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button appearance="primary" icon={<Print24Regular />} onClick={() => window.print()}>
      {label}
    </Button>
  );
}
