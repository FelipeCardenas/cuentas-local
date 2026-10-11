import { units, decimal, selectedCategoryTotals } from "./domain.js";

export const chartColors = ["#246d5c", "#597da0", "#a35379", "#aa641e", "#657a34", "#725aa3", "#247e8b", "#9e5050"];
const exactUnits = (value) => units(typeof value === "number" ? value.toFixed(6) : value);

export function expenseDatasets(rows, people, person = "total", label = "Total", stack = "gasto") {
  const members = people.length ? people : [{id: "mi", name: "Mi"}, {id: "amor", name: "Amor"}];
  if (person !== "total") return [{label, color: chartColors[Math.max(0, members.findIndex((p) => p.id === person)) % chartColors.length], data: rows.map((r) => r?.[person] ?? null)}];
  const datasets = members.map((p, i) => ({
    label: label === "Total" ? p.name : `${label} · ${p.name}`,
    color: chartColors[i % chartColors.length], stack,
    data: rows.map((r) => r ? Number(r[p.id] ?? 0) : null),
  }));
  // Special/incomplete allocations must never change the real expense total.
  const remainder = rows.map((r) => r ? Number(decimal(exactUnits(r.total ?? 0) - members.reduce((s, p) => s + exactUnits(r[p.id] ?? 0), 0n))) : null);
  if (remainder.some((v) => v !== null && v !== 0)) datasets.push({
    label: `${label === "Total" ? "" : label + " · "}Sin asignar / ajuste`, color: "#687078", stack, data: remainder,
  });
  return datasets;
}

export function categoryChartRows(rows, people) {
  const total = selectedCategoryTotals(rows);
  const members = people.length ? people : [{id: "mi"}, {id: "amor"}];
  const parts = Object.fromEntries(members.map((p) => [p.id, selectedCategoryTotals(rows.map((r) => ({months: r.people?.[p.id] || Array(12).fill(null)}))).months]));
  return total.months.map((value, i) => value === null ? null : {
    total: value, ...Object.fromEntries(members.map((p) => [p.id, parts[p.id][i] ?? 0])),
  });
}

export function barGroups(datasets) {
  const groups = new Map();
  datasets.forEach((d, i) => {
    const key = d.stack ?? `dataset-${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  return [...groups.values()];
}
