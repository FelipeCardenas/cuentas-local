export const money = (n) =>
  n === null || n === undefined || n === ""
    ? "—"
    : new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 2,
      }).format(Number(n));
export const date = (s) =>
  s
    ? new Date(s + "T12:00:00").toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
export const month = (s) =>
  s
    ? new Date(s + "-01T12:00:00").toLocaleDateString("es-CL", {
        month: "long",
        year: "numeric",
      })
    : "Sin período";
export const months = Array.from({ length: 12 }, (_, i) =>
  new Date(2026, i, 1).toLocaleDateString("es-CL", { month: "short" }),
);
export const pct = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: 1,
        signDisplay: "exceptZero",
      }).format(n) + " %";
export const states = {
  pendiente: "Pendiente",
  aceptado: "Confirmado",
  duplicado: "Duplicado",
  excluido_gasto: "No considerado",
};
export const kinds = {
  gasto: "Compra",
  devolucion: "Devolución",
  pago_tarjeta: "Pago CMR",
  ingreso: "Ingreso",
};
export const batchLabel = (b) =>
  `${b.kind === "historico" ? "Histórico conciliado" : b.name} · #${b.id} ${b.period ? month(b.period) : "Varios períodos"}`;
export const emptyFilters = () => ({
  batch: "",
  state: "pendiente",
  month: "",
  year: "",
  category: "",
  date_from: "",
  date_to: "",
  kind: "",
  q: "",
  show_duplicates: "0",
});
export function average(a) {
  return a.map((_, i) =>
    i < 2 || a.slice(i - 2, i + 1).some((v) => v === null)
      ? null
      : a.slice(i - 2, i + 1).reduce((s, v) => s + v, 0) / 3,
  );
}
export function projection(a, b) {
  const last = a.reduce((end, v, i) => (v === null ? end : i), -1);
  const pairs = a
    .map((v, i) => (v !== null && b[i] !== null ? i : null))
    .filter((i) => i !== null);
  const base = pairs.reduce((s, i) => s + b[i], 0),
    actual = pairs.reduce((s, i) => s + a[i], 0);
  const rate = pairs.length && base > 0 ? (actual - base) / base : null;
  return {
    last,
    rate,
    pairs: pairs.length,
    forecast: a.map((v, i) =>
      last >= 0 && i > last && b[i] !== null && rate !== null
        ? Math.round(b[i] * (1 + rate) * 100) / 100
        : null,
    ),
  };
}
export function units(value) {
  const match = String(value ?? "").match(/^(-?)(\d+)(?:\.(\d{0,6}))?$/);
  if (!match) throw new Error("Importe inválido; máximo seis decimales.");
  return (
    (match[1] ? -1n : 1n) *
    (BigInt(match[2]) * 1000000n + BigInt((match[3] || "").padEnd(6, "0")))
  );
}
export function decimal(value) {
  const sign = value < 0n ? "-" : "";
  const v = value < 0n ? -value : value;
  return (
    sign + String(v / 1000000n) + "." + String(v % 1000000n).padStart(6, "0")
  );
}
export function split(amount, percent) {
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 0 || p > 100)
    throw new Error("Porcentaje entre 0 y 100.");
  const total = units(amount);
  if (total % 1000000n !== 0n)
    throw new Error("El importe tiene fracciones de peso; conserva su reparto exacto o edítalo manualmente.");
  const pesos = total / 1000000n;
  const sign = pesos < 0n ? -1n : 1n;
  const share = sign * (((pesos * sign) * BigInt(Math.round(p * 100)) + 5000n) / 10000n);
  return [String(share), String(pesos - share)];
}
export function equalShares(amount, count) {
  const total = units(amount);
  if (!Number.isInteger(count) || count < 1) throw new Error("Faltan integrantes.");
  if (total % 1000000n !== 0n) throw new Error("El importe tiene fracciones de peso; conserva su reparto exacto o edítalo manualmente.");
  const pesos = total / 1000000n, n = BigInt(count), part = pesos / n, rest = pesos % n;
  return Array.from({ length: count }, (_, i) => String(part + (BigInt(i) < (rest < 0n ? -rest : rest) ? (rest < 0n ? -1n : 1n) : 0n)));
}
