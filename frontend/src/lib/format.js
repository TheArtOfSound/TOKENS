export const compact = (v) =>
  v == null || isNaN(v)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: v >= 1e9 ? 2 : 1,
      }).format(v);

export const full = (v) =>
  v == null || isNaN(v) ? "—" : new Intl.NumberFormat("en-US").format(Math.round(v));

export const usd = (v) =>
  v == null || isNaN(v)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(v);

export const usd2 = (v) =>
  v == null || isNaN(v)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(v);

export const pct = (n, d) => (!d ? "—" : `${((n / d) * 100).toFixed(1)}%`);

export const ago = (iso) => {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
