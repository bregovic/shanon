"use client";

import {
  Apps24Regular,
  BuildingShop24Regular,
  PeopleMoney24Regular,
  BookNumber24Regular,
  Beaker24Regular,
  Box24Regular,
  BoxMultiple24Regular,
  Building24Regular,
  Cart24Regular,
  PlugConnected24Regular,
  BuildingBank24Regular,
  ReceiptMoney24Regular,
  Settings24Regular,
} from "@fluentui/react-icons";

/** Ikony modulů podle ModuleDef.icon. Nový modul s novou ikonou = přidat sem. */
const MODULE_ICONS: Record<string, React.ComponentType> = {
  Settings: Settings24Regular,
  BuildingBank: BuildingBank24Regular,
  BookNumber: BookNumber24Regular,
  ReceiptMoney: ReceiptMoney24Regular,
  PeopleMoney: PeopleMoney24Regular,
  BuildingShop: BuildingShop24Regular,
  Beaker: Beaker24Regular,
  Box: Box24Regular,
  BoxMultiple: BoxMultiple24Regular,
  Building: Building24Regular,
  Cart: Cart24Regular,
  PlugConnected: PlugConnected24Regular,
};

export function ModuleIcon({ name }: { name: string }) {
  const I = MODULE_ICONS[name] ?? Apps24Regular;
  return <I />;
}
