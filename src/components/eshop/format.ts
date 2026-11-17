/** Částka v měně obchodu (server i prohlížeč). */
export const money = (v: string | number, currency: string) => Number(v).toLocaleString("cs-CZ", { style: "currency", currency, minimumFractionDigits: 2 });
