/** Můj profil (kolečko s iniciálami): jméno, e-mail, změna hesla. */
import { userSettingsPage } from "../settings/user-settings-page";

export const metadata = { title: "Můj profil" };

export default async function ProfilePage() {
  return userSettingsPage("profile");
}
