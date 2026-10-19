export const fmtInt = (v: number) => Math.round(v).toLocaleString('fr-FR');
export const fmtMoney = (v: number) => `${fmtInt(v)} cr`;
export const fmtPct = (v: number, digits = 0) => `${(v * 100).toFixed(digits).replace('.', ',')} %`;
export const fmtSigned = (v: number) => `${v >= 0 ? '+' : '−'}${fmtInt(Math.abs(v))}`;
