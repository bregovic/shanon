/** Texty aplikace Portál pro klientské komponenty (labely @INT:App…). */
const KEYS = [
  "AppTitle", "AppEmployee", "AppVendor", "AppPersonalNum", "AppPassword", "AppSignIn", "AppEmail", "AppSendLink", "AppLinkSent",
  "AppLinkInvalid", "AppVendorHint", "AppEmployeeHint", "AppCompany", "AppSignOut", "AppAgenda", "AppTakePhoto", "AppChooseFile",
  "AppNote", "AppNotePlaceholder", "AppSend", "AppSending", "AppSent", "AppSentDoc", "AppAnother", "AppEditPhoto", "AppRotate",
  "AppEnhance", "AppStraighten", "AppReset", "AppDone", "AppRemove", "AppCornersHint", "AppSetPassword", "AppNewPassword",
  "AppRepeatPassword", "AppPasswordMismatch", "AppPasswordShortHint", "AppSave", "AppLinkExpired", "AppNoAgenda", "AppInstall",
  "AppInstallIos", "AppInstalled", "AppFiles", "AppProcessing", "AppError", "AppHello",
] as const;

export type PortalLabels = Record<(typeof KEYS)[number], string>;

export const portalLabels = (t: (r: string) => string): PortalLabels => Object.fromEntries(KEYS.map((k) => [k, t(`@INT:${k}`)])) as PortalLabels;
