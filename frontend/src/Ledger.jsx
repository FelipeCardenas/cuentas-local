import { useEffect, useState, useRef } from "react";
import { Search, Download, CheckCheck, ChevronRight, Check, ArchiveX } from "lucide-react";
import {
  useQuery,
  Status,
  ErrorBox,
  IconButton,
  Metrics,
  Pagination,
  Badge,
  Modal,
  useGuard,
} from "./ui";
import { money, date, month, months, kinds, batchLabel } from "./domain";
import { post, download } from "./api";

export default function Ledger({
  config,
  filters,
  setFilters,
  revision,
  onReview,
  onChanged,
  onCount,
}) {
  const [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [bulk, setBulk] = useState(null),
    [busy, setBusy] = useState(false);
  const key = JSON.stringify(filters);
  const rowLock = useRef(false);
  async function quickReview(r, action) {
    if (busy || rowLock.current) return;
    if (action === "descartar" && !window.confirm(`¿Rechazar el movimiento #${r.id}? Podrás recuperarlo en Descartados.`)) return;
    rowLock.current = true;
    setBusy(true);
    setError("");
    try {
      await post("/api/review", { id: r.id, version: r.version, action,
        ...(action === "aceptar" ? { allocations: r.allocations } : {}) });
      await onChanged(action === "aceptar" ? "Movimiento confirmado" : "Movimiento descartado");
    } catch (e) { setError(e.message); }
    finally { rowLock.current = false; setBusy(false); }
  }
  useEffect(() => {
    setPage(1);
  }, [key]);
  const invalid =
    filters.date_from && filters.date_to && filters.date_from > filters.date_to;
  const query = useQuery(
    invalid
      ? null
      : "/api/movements?" + new URLSearchParams({ ...filters, page }),
    revision,
  );
  const data = query.data;
  useEffect(() => {
    if (data) {
      onCount(data.summary.pendientes_globales);
      if (page > data.pages) setPage(data.pages);
    }
  }, [data]);
  useGuard(busy);
  const change = (k, v) => {
    setPage(1);
    setFilters({ ...filters, [k]: v });
  };
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      setBulk({
        plan: await post("/api/bulk-preview", { filters }),
        filters: { ...filters },
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await post("/api/bulk-confirm", {
        filters: bulk.filters,
        token: bulk.plan.token,
      });
      setBulk(null);
      await onChanged("Movimientos confirmados");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const s = data?.summary,
    p = data?.pending;
  return (
    <section id="ledger">
      <div className="scope">
        <label htmlFor="batch">Importación</label>
        <select
          id="batch"
          value={filters.batch}
          onChange={(e) => change("batch", e.target.value)}
        >
          <option value="">Todos los lotes</option>
          {config.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {batchLabel(b)}
            </option>
          ))}
        </select>
        <span className="currency">CLP · Pesos chilenos</span>
      </div>
      {s && (
        <Metrics
          className="ledger-metrics"
          items={[
            [
              "Total bruto filtrado",
              money(s.bruto_clp),
              "Antes de revisar coincidencias",
            ],
            [
              "Deduplicado propuesto",
              money(s.deduplicado_propuesto_clp),
              "Estimación automática",
            ],
            [
              "Real confirmado",
              money(s.real_confirmado_clp),
              "Solo movimientos aceptados",
            ],
            ["Pendientes filtrados", s.pendientes, "Gastos y devoluciones"],
            ...config.people.map((p) => [
              `${p.name} · confirmado`,
              money(s.allocations?.[p.id] || 0),
              p.active
                ? "Filtros actuales · todas las páginas"
                : "Integrante retirado",
            ]),
          ]}
        />
      )}
      <div className="table-toolbar">
        <div className="tabs" role="tablist">
          {[
            ["pendiente", "Pendientes"],
            ["aceptado", "Confirmados"],
            ["", "Todos"],
            ["excluido_gasto", "Descartados"],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filters.state === value}
              className={filters.state === value ? "selected" : ""}
              onClick={() => change("state", value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filters">
          <label className="search">
            <Search />
            <input
              placeholder="Buscar movimiento"
              aria-label="Buscar movimiento"
              value={filters.q}
              onChange={(e) => change("q", e.target.value)}
            />
          </label>
          {[
            [
              "category",
              "Categoría",
              [...config.categories.map((c) => [c, c])],
            ],
            [
              "month",
              "Mes",
              months.map((m, i) => [String(i + 1).padStart(2, "0"), m]),
            ],
            [
              "year",
              "Año",
              [...new Set(config.periods.map((p) => p.slice(0, 4)))].map(
                (y) => [y, y],
              ),
            ],
          ].map(([key, label, options]) => (
            <label className="review-filter" key={key}>
              {label}
              <select
                aria-label={label}
                value={filters[key]}
                onChange={(e) => change(key, e.target.value)}
              >
                <option value="">Todos</option>
                {options.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {[
            ["date_from", "Desde"],
            ["date_to", "Hasta"],
          ].map(([key, label]) => (
            <label className="review-filter" key={key}>
              {label}
              <input
                type="date"
                value={filters[key]}
                onChange={(e) => change(key, e.target.value)}
              />
            </label>
          ))}
          <select
            aria-label="Tipo"
            value={filters.kind}
            onChange={(e) => change("kind", e.target.value)}
          >
            <option value="">Todos los tipos</option>
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorBox
        error={
          invalid ? "La fecha inicial no puede ser posterior a la final" : error
        }
      />
      <Status {...query} />
      {p && filters.state === "pendiente" && (
        <section className="pending-strip">
          {config.people.map((person) => (
            <div key={person.id}>
              <span>Pendiente · {person.name}</span>
              <strong>{money(p.allocations?.[person.id] || 0)}</strong>
            </div>
          ))}
          <div className="pending-scope">
            <span>Todos los pendientes filtrados · todas las páginas</span>
            {!!p.incomplete && (
              <small>
                {p.incomplete} repartos incompletos (totales parciales)
              </small>
            )}
            {!!p.unbalanced && (
              <small>{p.unbalanced} repartos por cuadrar</small>
            )}
          </div>
          <button
            className="primary"
            disabled={busy || !p.selected}
            onClick={prepare}
          >
            <CheckCheck />
            Confirmar todos
          </button>
        </section>
      )}
      <div className="filtered-export">
        <label className="special-toggle">
          <input
            type="checkbox"
            checked={filters.show_duplicates === "1"}
            onChange={(e) =>
              change("show_duplicates", e.target.checked ? "1" : "0")
            }
          />
          Mostrar copias duplicadas (auditoría)
        </label>
        <IconButton
          icon={Download}
          title="Descargar filtrados en Excel"
          disabled={!!invalid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await download(filters);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Fecha / período",
                    "Movimiento",
                    "Categoría",
                    "Monto",
                    ...config.people.map((p) => p.name),
                    "Estado",
                    "",
                  ].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {date(r.purchase_date)}
                      <small>
                        {month(r.period)}
                        {r.installment ? " · Cuota" : ""}
                      </small>
                    </td>
                    <td className="description">
                      {r.description}
                      <small>
                        {kinds[r.kind]} · #{r.id}
                        {r.issue_count ? ` · ${r.issue_count} avisos` : ""}
                      </small>
                      <small className="mobile-date">
                        {date(r.purchase_date)} · {r.category}
                      </small>
                    </td>
                    <td>{r.category || "Sin categoría"}</td>
                    <td className="numeric">{money(r.amount)}</td>
                    {config.people.map((p) => (
                      <td key={p.id} className="numeric">
                        {money(r.allocations?.[p.id] ?? 0)}
                      </td>
                    ))}
                    <td>
                      <Badge row={r} />
                    </td>
                    <td className="movement-actions">
                      <div>
                      {r.state === "pendiente" && r.kind !== "pago_tarjeta" && <>
                        <IconButton icon={Check} title={`Confirmar movimiento ${r.id}`} disabled={busy || !r.category || !!r.issue_count} onClick={() => quickReview(r, "aceptar")} />
                        <IconButton icon={ArchiveX} title={`Rechazar movimiento ${r.id}`} disabled={busy} onClick={() => quickReview(r, "descartar")} />
                      </>}
                      <IconButton
                        icon={ChevronRight}
                        title={`Revisar movimiento ${r.id}`}
                        disabled={busy}
                        onClick={() => onReview(r.id)}
                      />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.count && (
            <div className="empty">
              <h2>Sin movimientos</h2>
            </div>
          )}
          <Pagination
            page={page}
            pages={data.pages}
            count={data.count}
            onChange={setPage}
          />
        </>
      )}
      {bulk && (
        <Modal
          id="bulkDialog"
          title="Confirmar pendientes"
          busy={busy}
          onClose={() => setBulk(null)}
        >
          <p>
            <b>{bulk.plan.eligible} movimientos</b> se confirmarán en todas las
            páginas del filtro.
          </p>
          <p>
            Las coincidencias se conservarán como compras independientes. Las
            categorías y repartos no cambiarán.
          </p>
          {bulk.plan.skipped.length > 0 && (
            <div className="notice">
              {bulk.plan.skipped.length} seguirán pendientes.
              <ul>
                {[...new Set(bulk.plan.skipped.flatMap((r) => r.reasons))].map(
                  (r) => (
                    <li key={r}>{r}</li>
                  ),
                )}
              </ul>
            </div>
          )}
          <ErrorBox error={error} />
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setBulk(null)}
            >
              Cancelar
            </button>
            <button
              className="primary"
              disabled={busy || !bulk.plan.eligible}
              onClick={confirm}
            >
              <CheckCheck />
              Confirmar {bulk.plan.eligible}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
