import { test } from "node:test";
import assert from "node:assert/strict";
import { expenseDatasets, categoryChartRows, barGroups } from "../src/chartData.js";
import { barValueLabels } from "../src/chartLabels.js";

const people = [{id: "a", name: "Ana"}, {id: "b", name: "Beto"}];
test("stacked amounts preserve totals, null months, refunds and special allocations", () => {
  const rows = [{total: 100, a: 30, b: 70}, null, {total: -20, a: -10, b: -10}, {total: 50, a: 80, b: 0}];
  const parts = expenseDatasets(rows, people);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[2].data, [0, null, 0, -30]);
  for (const i of [0, 2, 3]) assert.equal(parts.reduce((s, p) => s + p.data[i], 0), rows[i].total);
  assert.equal(expenseDatasets(rows, people, "a", "Ana")[0].color, parts[0].color);
  assert.deepEqual(expenseDatasets(rows, people, "a", "Ana")[0].data, [30, null, -10, 80]);
  assert.equal(expenseDatasets([{total: 0.3, a: 0.1, b: 0.2}], people).length, 2);
  assert.equal(expenseDatasets([{total: 0.000001, a: 0.000001, b: 0}], people).length, 2);
  const years = [...expenseDatasets(rows, people, "total", "2026", "actual"), ...expenseDatasets(rows, people, "total", "2025", "reference")];
  assert.equal(barGroups(years).length, 2);
  assert.equal(barGroups([{data: [1]}, {data: [2]}]).length, 2);
});
test("category selections change every member series without mixing categories", () => {
  const months = (v) => [v, ...Array(11).fill(null)];
  const a = {months: months("100"), people: {a: months("40"), b: months("60")}};
  const b = {months: months("-20"), people: {b: months("-20")}};
  assert.deepEqual(categoryChartRows([a, b], people)[0], {total: "80.000000", a: "40.000000", b: "40.000000"});
  assert.equal(categoryChartRows([a], people)[0].b, "60.000000");
  assert.deepEqual(categoryChartRows([], people), Array(12).fill(null));
});
test("bar labels draw totals and fitting segments without hovering", () => {
  const labels = [];
  const positions = [];
  const ctx = {save(){}, restore(){}, translate(){}, rotate(){}, measureText: (s) => ({width: s.length * 5}), fillText: (s, x, y) => {labels.push(s); positions.push([x,y]);}};
  const chart = {ctx, config: {type: "bar"}, options: {indexAxis: "x"},
    data: {labels: ["oct"], datasets: [{stack: "total", data: [40]}, {stack: "total", data: [60]}]},
    isDatasetVisible: () => true,
    getDatasetMeta: (i) => ({data: [{x: 100, y: i ? 40 : 100, base: i ? 100 : 140, width: 100}]}),
  };
  barValueLabels.afterDatasetsDraw(chart);
  assert.deepEqual(labels, ["$100", "$40", "$60"]);
  chart.config.type = "line";
  barValueLabels.afterDatasetsDraw(chart);
  assert.equal(labels.length, 3);
  chart.config.type = "bar";
  chart.options.indexAxis = "y";
  chart.data.datasets = [{data: [-10000]}];
  chart.getDatasetMeta = () => ({data: [{x: 30, base: 90, y: 20, height: 30}]});
  barValueLabels.afterDatasetsDraw(chart);
  assert.equal(labels.at(-1), "$-10.000");
  assert.deepEqual(positions.at(-1), [96,20]);
});
