/** Nastavení (ozubené kolo): jazyk, výchozí firma, oznámení, PIN do pokladny, instalace aplikace. */
import { userSettingsPage } from "./user-settings-page";

export const metadata = { title: "Nastavení" };

export default async function SettingsPage() {
  return userSettingsPage("settings");
}
