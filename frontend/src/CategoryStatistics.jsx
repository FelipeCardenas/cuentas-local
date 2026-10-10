import { useEffect, useRef, useState } from "react";
import { CheckCheck, ListFilter, Square, Table2 } from "lucide-react";
import { Field, Status, useQuery } from "./ui";
import { money, months, selectedCategoryTotals } from "./domain";

export default function CategoryStatistics({ revision, Graph }) {
  const [year, setYear] = useState(""), [person, setPerson] = useState("total"),
    [basis, setBasis] = useState("period"), [excluded, setExcluded] = useState(new Set()),
    [search, setSearch] = useState(""), [sort, setSort] = useState("total");
  const picker = useRef();
  const query = useQuery("/api/statistics-categories?" + new URLSearchParams({ year, person, basis }), revision);
  useEffect(() => {
    const close = (e) => { if (picker.current && !picker.current.contains(e.target)) picker.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const data = query.data;
  const rows = (data?.rows || []).filter((r) => !excluded.has(r.name)).sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name, "es") : Number(b.total) - Number(a.total) || a.name.localeCompare(b.name, "es"));
  const total = selectedCategoryTotals(rows);
  const names = (data?.rows || []).map((r) => r.name);
  const toggle = (name) => setExcluded((previous) => {
    const next = new Set(previous);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  return <section id="categoryStatistics" className="stats-category-analysis">
    <h2 className="stats-section-title"><Table2 aria-hidden="true" />Gasto por categoría y mes</h2>
    <div className="filters stats-filters">
      <Field label="Año de categorías"><select value={year || data?.year || ""} onChange={(e) => setYear(e.target.value)}>
        {!data && <option value={year}>{year || "Cargando…"}</option>}
        {data && [...new Set([data.year, ...data.years])].sort().reverse().map((y) => <option key={y}>{y}</option>)}
      </select></Field>
      <Field label="Gasto de categorías"><select value={person} onChange={(e) => setPerson(e.target.value)}>
        <option value="total">Total</option>
        {(data?.people || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (retirado)"}</option>)}
      </select></Field>
      <Field label="Agrupar categorías por"><select value={basis} onChange={(e) => setBasis(e.target.value)}>
        <option value="period">Período asignado</option><option value="purchase_date">Fecha de compra</option>
      </select></Field>
      <Field label="Orden de categorías"><select value={sort} onChange={(e) => setSort(e.target.value)}>
        <option value="total">Mayor gasto anual</option><option value="name">Nombre</option>
      </select></Field>
      <details className="category-picker" ref={picker} onKeyDown={(e) => { if (e.key === "Escape") { picker.current.open = false; picker.current.querySelector("summary").focus(); } }}>
        <summary><ListFilter aria-hidden="true" />Categorías ({rows.length}/{names.length})</summary>
        <div className="category-picker-popover">
          <Field label="Buscar categorías"><input value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <div className="category-picker-actions">
            <button type="button" onClick={() => setExcluded(new Set())}><CheckCheck aria-hidden="true" />Todas</button>
            <button type="button" onClick={() => setExcluded(new Set(names))}><Square aria-hidden="true" />Ninguna</button>
          </div>
          <div className="category-picker-options" role="group" aria-label="Categorías visibles">
            {names.filter((name) => name.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))).map((name) =>
              <label key={name}><input type="checkbox" checked={!excluded.has(name)} onChange={() => toggle(name)} />{name}</label>)}
          </div>
        </div>
      </details>
    </div>
    <p className="muted">Confirmados menos devoluciones · CLP · {basis === "period" ? "período asignado" : "fecha de compra"}</p>
    <Status {...query} />
    {data && (rows.length ? <>
      <div className="category-selection-total"><span>Total seleccionado · {data.year}</span><strong>{money(total.total)}</strong><small>{rows.length} categorías</small></div>
      <Graph label="Totales mensuales de las categorías seleccionadas" datasets={[{ label: "Categorías seleccionadas", data: total.months.map((v) => v === null ? null : Number(v)) }]} />
      <div className="table-wrap category-pivot" tabIndex={0} role="region" aria-label="Gasto por categoría y mes">
        <table><thead><tr><th scope="col">Categoría</th>{months.map((m) => <th className="numeric" scope="col" key={m}>{m}</th>)}<th className="numeric" scope="col">Total anual</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.name}><th scope="row">{r.name}</th>{r.months.map((v, i) => <td className="numeric" key={i}>{money(v)}</td>)}<td className="numeric category-row-total">{money(r.total)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row">Total seleccionado</th>{total.months.map((v, i) => <td className="numeric" key={i}>{money(v)}</td>)}<td className="numeric">{money(total.total)}</td></tr></tfoot>
        </table>
      </div>
    </> : <p>{names.length ? "No hay categorías seleccionadas." : "Sin gastos confirmados para este año."}</p>)}
  </section>;
}
