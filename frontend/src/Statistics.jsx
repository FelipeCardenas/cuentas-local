import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { useQuery, Status, Field, Metrics } from "./ui";
import { money, pct, months, average, projection } from "./domain";
const colors = ["#246d5c", "#597da0", "#d47716"];
function Graph({
  labels = months,
  datasets,
  type = "bar",
  horizontal = false,
  label,
}) {
  const ref = useRef();
  useEffect(() => {
    const chart = new Chart(ref.current, {
      type,
      data: {
        labels,
        datasets: datasets.map((d, i) => ({
          ...d,
          borderColor: d.color || colors[i % 3],
          backgroundColor: d.color || colors[i % 3],
          borderWidth: 2,
          pointRadius: 3,
          spanGaps: false,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? "y" : "x",
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (c) =>
                `${c.dataset.label}: ${money(horizontal ? c.parsed.x : c.parsed.y)}`,
            },
          },
        },
        scales: {
          [horizontal ? "x" : "y"]: {
            beginAtZero: true,
            ticks: {
              callback: (v) =>
                new Intl.NumberFormat("es-CL", { notation: "compact" }).format(
                  v,
                ),
            },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, datasets, type, horizontal]);
  return (
    <div className={horizontal ? "explanation-canvas" : "stats-canvas"}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}
export default function Statistics({ revision }) {
  const query = useQuery("/api/statistics", revision);
  return (
    <section id="statsPanel">
      <WeeklyStatistics revision={revision} />
      <Status {...query} />
      {query.data &&
        (Object.keys(query.data.years).length ? (
          <StatisticsContent
            years={query.data.years}
            people={query.data.people || []}
          />
        ) : (
          <div className="empty">
            <h2>Sin gastos confirmados</h2>
          </div>
        ))}
    </section>
  );
}
function WeeklyStatistics({ revision }) {
  const query = useQuery("/api/statistics-weekly", revision);
  const [selectedYear, setYear] = useState(""),
    [selectedMonth, setMonth] = useState(""),
    [person, setPerson] = useState("total");
  const years = query.data?.years || {};
  const options = Object.keys(years).sort().reverse();
  const year = years[selectedYear] ? selectedYear : options[0] || "";
  const month = selectedMonth || Object.keys(years[year] || {}).sort().at(-1) || "01";
  const people = query.data?.people || [];
  const activePerson = person === "total" || people.some((p) => p.id === person) ? person : "total";
  const rows = years[year]?.[month] || [];
  const range = (r) => `${r.start.slice(8)}/${month} – ${r.end.slice(8)}/${month}`;
  const values = rows.map((r) => r[activePerson] ?? 0);
  return (
    <section className="stats-chart-section" id="weeklyStatistics">
      <h2>Gasto semanal</h2>
      <Status {...query} />
      {query.data && !options.length && <p>Sin gastos confirmados.</p>}
      {!!options.length && <>
        <div className="filters stats-filters">
          <Field label="Año semanal"><select value={year} onChange={(e) => { setYear(e.target.value); setMonth(""); }}>
            {options.map((y) => <option key={y}>{y}</option>)}
          </select></Field>
          <Field label="Mes semanal"><select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((name, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{name}</option>)}
          </select></Field>
          <Field label="Gasto semanal"><select value={activePerson} onChange={(e) => setPerson(e.target.value)}>
            <option value="total">Total</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (retirado)"}</option>)}
          </select></Field>
        </div>
        <p className="muted">Fecha de compra · lunes a domingo · solo días del mes · confirmados menos devoluciones · CLP</p>
        {!rows.length ? <p>Sin gastos confirmados en este mes.</p> : <>
          <Graph label="Gasto semanal del mes; valores en tabla" labels={rows.map(range)} datasets={[{label: people.find((p) => p.id === activePerson)?.name || "Total", data: values}]} />
          <div className="table-wrap"><table>
            <thead><tr><th>Semana</th><th>Fechas</th><th>Movimientos del hogar</th><th>Gasto neto CLP</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={r.start}><td>Semana {i + 1}</td><td>{range(r)}</td><td>{r.count}</td><td className="numeric">{money(values[i])}</td></tr>)}</tbody>
            <tfoot><tr><th colSpan={3}>Total {months[Number(month) - 1]} {year}</th><td className="numeric">{money(values.reduce((sum, v) => sum + v, 0))}</td></tr></tfoot>
          </table></div>
        </>}
      </>}
    </section>
  );
}
function StatisticsContent({ years, people }) {
  const options = Object.keys(years).sort().reverse(),
    [year, setYear] = useState(options[0]),
    [compare, setCompare] = useState(options[1] || ""),
    [person, setPerson] = useState("total");
  const series = (y) =>
    (years[y] || Array(12).fill(null)).map((m) => m?.[person] ?? null);
  const a = series(year),
    b = series(compare),
    avg = average(a),
    baseYear =
      compare && Number(compare) < Number(year)
        ? compare
        : String(Number(year) - 1),
    proj = projection(a, series(baseYear));
  const pairs = a
      .map((v, i) => (v !== null && b[i] !== null ? i : null))
      .filter((i) => i !== null),
    sum = a.reduce((s, v) => s + (v ?? 0), 0),
    delta = pairs.reduce((s, i) => s + a[i] - b[i], 0),
    base = pairs.reduce((s, i) => s + b[i], 0);
  const projected = proj.forecast.filter((v) => v !== null).length,
    remaining = proj.forecast.reduce((s, v) => s + (v ?? 0), 0),
    complete =
      projected > 0 &&
      a.every((v, i) => v !== null || proj.forecast[i] !== null);
  const trend = [...proj.forecast];
  if (projected && trend[proj.last + 1] !== null)
    trend[proj.last] = a[proj.last];
  return (
    <>
      <div className="filters stats-filters">
        <Field label="Año">
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {options.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </Field>
        <Field label="Comparar con">
          <select value={compare} onChange={(e) => setCompare(e.target.value)}>
            <option value="">Sin comparación</option>
            {options.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </Field>
        <Field label="Gasto">
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="total">Total</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.active ? "" : " (retirado)"}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted">
        Confirmados · gastos menos devoluciones · período asignado · CLP. Los
        períodos pueden estar incompletos; sin registros: —.
      </p>
      <Metrics
        className="stats-metrics"
        items={[
          [
            `Total ${year}`,
            money(sum),
            `${a.filter((v) => v !== null).length} meses con registros`,
          ],
          [
            "Desviación interanual",
            pairs.length ? money(delta) : "—",
            `${pairs.length} meses comparables`,
          ],
          [
            "Variación interanual",
            pct(base === 0 ? null : (delta / Math.abs(base)) * 100),
            "Mismos meses con registros en ambos años",
          ],
        ]}
      />
      <Explanation
        {...{ year, compare, person }}
        personName={people.find((p) => p.id === person)?.name || "Total"}
        latest={a.reduce((n, v, i) => (v === null ? n : i), 0)}
      />
      <section className="stats-chart-section">
        <h2>Comparativa mensual</h2>
        <Graph
          label="Comparativa mensual; valores en tabla"
          datasets={[
            { label: year, data: a },
            { label: compare || "Sin comparación", data: b },
            { label: "Proyección", data: proj.forecast },
          ]}
        />
      </section>
      <section className="stats-chart-section">
        <h2>Tendencia mensual</h2>
        <p className="muted">
          {projected
            ? `Base ${baseYear} · ajuste ${pct(proj.rate * 100)} · ${proj.pairs} meses comparables. Estimación con registros disponibles, incluidos períodos parciales.`
            : "Sin proyección: falta referencia histórica futura o una base comparable positiva."}
        </p>
        <Graph
          type="line"
          label="Tendencia y proyección; valores en tabla"
          datasets={[
            { label: "Gasto mensual", data: a },
            { label: "Media móvil de 3 meses", data: avg },
            { label: "Proyección", data: trend, borderDash: [6, 4] },
          ]}
        />
      </section>
      <Metrics
        className="stats-metrics"
        items={[
          [
            "Gasto futuro proyectado",
            projected ? money(remaining) : "—",
            `${projected} meses con estimación`,
          ],
          [
            "Cierre anual estimado",
            complete ? money(sum + remaining) : "—",
            complete
              ? "Real acumulado + proyección"
              : "Sin cobertura completa de los 12 meses",
          ],
        ]}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Mes",
                year,
                compare || "Comparación",
                "Desviación CLP",
                "Variación %",
                "Media 3 meses",
                "Proyección",
              ].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.map((v, i) => {
              const d = v === null || b[i] === null ? null : v - b[i];
              return (
                <tr key={i}>
                  <td>{months[i]}</td>
                  <td className="numeric">{money(v)}</td>
                  <td className="numeric">{money(b[i])}</td>
                  <td className="numeric">{money(d)}</td>
                  <td className="numeric">
                    {pct(
                      d === null || b[i] === 0
                        ? null
                        : (d / Math.abs(b[i])) * 100,
                    )}
                  </td>
                  <td className="numeric">{money(avg[i])}</td>
                  <td className="numeric stats-projected">
                    {money(proj.forecast[i])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Explanation({ year, compare, person, personName, latest }) {
  const [m, setMonth] = useState(String(latest + 1).padStart(2, "0")),
    [group, setGroup] = useState("categories"),
    [direction, setDirection] = useState("all");
  const valid = compare && compare !== year;
  const query = useQuery(
    valid
      ? "/api/statistics-explanation?" +
          new URLSearchParams({
            current: `${year}-${m}`,
            reference: `${compare}-${m}`,
            person,
          })
      : null,
  );
  const data = query.data,
    rows = (data?.[group] || []).filter((r) =>
      direction === "up"
        ? r.delta > 0
        : direction === "down"
          ? r.delta < 0
          : true,
    );
  return (
    <section id="explanationPanel" className="stats-chart-section">
      <div className="section-heading">
        <h2>¿Qué explica la variación?</h2>
        <Field label="Mes">
          <select value={m} onChange={(e) => setMonth(e.target.value)}>
            {months.map((v, i) => (
              <option value={String(i + 1).padStart(2, "0")} key={i}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted">
        {months[Number(m) - 1]} {year} / {compare || "sin referencia"} ·{" "}
        {personName}
      </p>
      <Status {...query} />
      {!valid && <p>Selecciona dos años distintos para comparar este mes.</p>}
      {data && !data.comparable && (
        <p>
          Sin comparación: alguno de los períodos no tiene gastos confirmados o
          tiene repartos incompletos.
        </p>
      )}
      {data?.comparable && (
        <>
          <p>
            El gasto registrado{" "}
            {data.delta > 0
              ? "aumentó"
              : data.delta < 0
                ? "disminuyó"
                : "no varió"}{" "}
            {money(Math.abs(data.delta))} ({pct(data.percent)}).
          </p>
          <div className="notice">
            Los períodos pueden estar incompletos. Pendientes: {year}:{" "}
            {data.current.pending}; {compare}: {data.reference.pending}. Las
            categorías inferidas y «Otros» también forman parte del histórico.
          </div>
          <Metrics
            className="stats-metrics"
            items={[
              [
                `Gasto neto · ${year}`,
                money(data.current.net),
                `${compare}: ${money(data.reference.net)}`,
              ],
              [
                `Cantidad de compras · ${year}`,
                data.current.count,
                `${compare}: ${data.reference.count}`,
              ],
              [
                `Promedio por compra · ${year}`,
                money(data.current.average),
                `${compare}: ${money(data.reference.average)}`,
              ],
            ]}
          />
          <h3>Descomposición de la diferencia</h3>
          <div className="stats-effects">
            {data.effects ? (
              Object.entries({
                count: "Cambio en cantidad",
                average: "Cambio en promedio",
                refunds: "Cambio en devoluciones",
              }).map(([k, v]) => (
                <div key={k}>
                  <span>{v}</span>
                  <strong>{money(data.effects[k])}</strong>
                </div>
              ))
            ) : (
              <p>
                Se necesitan compras en ambos períodos para descomponer cantidad
                y promedio.
              </p>
            )}
          </div>
          <p className="muted">
            Descomposición simétrica de cantidad y promedio de compras;
            devoluciones aparte. Un promedio mayor no implica por sí solo
            precios más altos.
          </p>
          <div className="filters stats-filters">
            <Field label="Desglose">
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="categories">Categorías</option>
                <option value="merchants">Comercios / descripción</option>
              </select>
            </Field>
            <Field label="Variación">
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="up">Aumentos</option>
                <option value="down">Disminuciones</option>
              </select>
            </Field>
          </div>
          <h3>Mayores diferencias en pesos</h3>
          <Graph
            horizontal
            label="Diez mayores diferencias; detalle en tabla"
            labels={rows.slice(0, 10).map((r) => r.name)}
            datasets={[
              {
                label: "Diferencia",
                data: rows.slice(0, 10).map((r) => r.delta),
                color: rows
                  .slice(0, 10)
                  .map((r) => (r.delta > 0 ? "#d47716" : "#246d5c")),
              },
            ]}
          />
          <p className="muted">
            {rows.length} grupos · diferencia{" "}
            {direction === "all" ? "total" : "del filtro"}:{" "}
            {money(rows.reduce((s, r) => s + r.delta, 0))}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    group === "categories"
                      ? "Categoría"
                      : "Comercio / descripción",
                    "Actual",
                    "Referencia",
                    "Diferencia",
                    "Compras actual / ref.",
                    "Promedio actual / ref.",
                    "Devoluciones actual / ref.",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td className="explanation-name">{r.name}</td>
                    <td>{money(r.current.net)}</td>
                    <td>{money(r.reference.net)}</td>
                    <td>{money(r.delta)}</td>
                    <td>
                      {r.current.count} / {r.reference.count}
                    </td>
                    <td>
                      {money(r.current.average)} / {money(r.reference.average)}
                    </td>
                    <td>
                      {money(r.current.refunds)} / {money(r.reference.refunds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
