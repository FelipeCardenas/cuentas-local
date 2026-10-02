import { useEffect, useState, useRef } from "react";
import {
  Search,
  Scissors,
  Eye,
  Undo2,
  RefreshCw,
  Pencil,
  Check,
} from "lucide-react";
import { api, post } from "./api";
import { money, date, month, batchLabel, units } from "./domain";
import Allocations from "./Allocations";
import {
  Field,
  ErrorBox,
  Metrics,
  IconButton,
  Pagination,
  SelectAll,
  Modal,
  useGuard,
} from "./ui";
export default function Cuts({ config, revision, onChanged, onReview }) {
  const [history, setHistory] = useState([]),
    [last, setLast] = useState(null),
    [filters, setFilters] = useState(null),
    [plan, setPlan] = useState(null),
    [excluded, setExcluded] = useState(new Set()),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState(null),
    [note, setNote] = useState(""),
    [detail, setDetail] = useState(null);
  const seq = useRef(0);
  useGuard(busy);
  useEffect(() => {
    initialize();
    return () => {
      seq.current++;
    };
  }, [revision]);
  async function initialize() {
    const n = ++seq.current;
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      const data = await api("/api/cuts");
      if (n !== seq.current) return;
      setHistory(data.history);
      setLast(data.defaults.last_id);
      const f = {
        start: data.defaults.start,
        end: data.defaults.end,
        include_older: data.defaults.include_older,
        batch: "",
        automatic: !!data.defaults.last_id,
      };
      setFilters(f);
      const p = await post("/api/cut-preview", f);
      if (n !== seq.current) return;
      setPlan(p);
      setExcluded(new Set());
      setPage(1);
    } catch (e) {
      if (n === seq.current) setError(e.message);
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }
  function change(k, v) {
    setFilters((f) => ({ ...f, [k]: v, automatic: false }));
    setPlan(null);
    setConfirmation(null);
  }
  async function query(e) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      setPlan(await post("/api/cut-preview", filters));
      setExcluded(new Set());
      setPage(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const request = { ...filters, excluded: [...excluded] };
      const fresh = await post("/api/cut-preview", request);
      setPlan(fresh);
      setConfirmation({ request, plan: fresh });
      setNote("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await post("/api/cut-save", {
        ...confirmation.request,
        token: confirmation.plan.token,
        note,
      });
      setConfirmation(null);
      await onChanged(`Corte #${r.id} validado y guardado`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id) {
    if (
      busy ||
      !confirm(
        `¿Anular el corte #${id}? Sus movimientos volverán a quedar disponibles.`,
      )
    )
      return;
    setBusy(true);
    try {
      await post("/api/cut-cancel", { id });
      await onChanged("Corte anulado");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function show(id) {
    try {
      setDetail(await api("/api/cuts/" + id));
    } catch (e) {
      setError(e.message);
    }
  }
  const selected = plan?.rows.filter((r) => !excluded.has(r.id)) || [];
  const sum = (k) =>
    Number(
      selected.reduce((s, r) => s + units(r.allocations?.[k] ?? "0"), 0n),
    ) / 1e6;
  const toggle = (id, checked) =>
    setExcluded((old) => {
      const next = new Set(old);
      checked ? next.delete(id) : next.add(id);
      return next;
    });
  return (
    <section id="cutsPanel">
      <ErrorBox error={error} />
      {filters && (
        <form className="cut-filters" onSubmit={query}>
          <Field label="Desde">
            <input
              type="date"
              required
              disabled={busy}
              value={filters.start}
              onChange={(e) => change("start", e.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              required
              disabled={busy}
              value={filters.end}
              onChange={(e) => change("end", e.target.value)}
            />
          </Field>
          <Field label="Importación">
            <select
              disabled={busy}
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
          </Field>
          <button className="primary" disabled={busy}>
            <Search />
            Consultar
          </button>
          <label className="special-toggle cut-older">
            <input
              type="checkbox"
              disabled={busy}
              checked={filters.include_older}
              onChange={(e) => change("include_older", e.target.checked)}
            />
            Incluir movimientos anteriores aún no considerados
          </label>
        </form>
      )}
      {busy && !plan && <p role="status">Consultando…</p>}
      {plan && (
        <>
          <Metrics
            className="cut-metrics"
            items={config.people.map((p) => [
              `${p.name} · gasto del corte`,
              money(sum(p.id)),
            ])}
          />
          {(plan.pending > 0 ||
            plan.older_count > 0 ||
            plan.adjustments > 0) && (
            <div className="notice">
              {plan.pending > 0 &&
                `${plan.pending} movimientos pendientes no se incluyen en los totales. `}
              {plan.older_count > 0 &&
                `${plan.older_count} movimientos anteriores sin corte ${filters.include_older ? "incluidos" : "fuera de la consulta"}. `}
              {plan.adjustments > 0 &&
                `${plan.adjustments} ajustes por cambios posteriores a cortes validados; solo se considera la diferencia.`}
            </div>
          )}
          <div className="section-heading">
            <span>
              {selected.length} seleccionados de {plan.rows.length} · solo
              gastos y devoluciones confirmados
            </span>
            <button
              className="primary"
              disabled={busy || !selected.length}
              onClick={prepare}
            >
              <Scissors />
              Validar y guardar
            </button>
          </div>
          <div className="cut-list-wrap">
            <table className="cut-table">
              <thead>
                <tr>
                  <th>
                    <SelectAll
                      selected={selected.length}
                      total={plan.rows.length}
                      onChange={(checked) =>
                        setExcluded(
                          checked
                            ? new Set()
                            : new Set(plan.rows.map((r) => r.id)),
                        )
                      }
                    />
                  </th>
                  {[
                    "Fecha / período",
                    "Movimiento",
                    "Categoría",
                    ...config.people.map((p) => p.name),
                    "",
                  ].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.slice((page - 1) * 35, page * 35).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={busy}
                        aria-label={`Incluir movimiento ${r.id}`}
                        checked={!excluded.has(r.id)}
                        onChange={(e) => toggle(r.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      {r.installment ? month(r.period) : date(r.date)}
                      <small>
                        {r.installment ? "Cuota · mes asignado" : ""}
                      </small>
                    </td>
                    <td className="description">
                      {r.description}
                      <small>
                        #{r.id} · Lote #{r.batch_id}
                        {r.adjustment ? " · Ajuste de corte anterior" : ""}
                      </small>
                    </td>
                    <td className="cut-category">
                      {r.category || "Sin categoría"}
                    </td>
                    {config.people.map((p) => (
                      <td className="numeric" key={p.id}>
                        {money(r.allocations?.[p.id] ?? 0)}
                      </td>
                    ))}
                    <td>
                      <IconButton
                        icon={Pencil}
                        title={`Revisar movimiento ${r.id}`}
                        disabled={busy}
                        onClick={() => onReview(r.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pages={Math.max(1, Math.ceil(plan.rows.length / 35))}
            onChange={setPage}
          />
        </>
      )}
      <div className="section-heading">
        <h2>Cortes guardados</h2>
        <IconButton
          icon={RefreshCw}
          title="Actualizar cortes"
          disabled={busy}
          onClick={initialize}
        />
      </div>
      {history.map((c) => (
        <div className="cut-history-row" key={c.id}>
          <div>
            <strong>
              Corte #{c.id}
              {c.cancelled_at ? " · Anulado" : ""}
            </strong>
            <small>
              {date(c.start_date)} a {date(c.end_date)} · {c.count} movimientos
            </small>
            <small>
              Validado: {new Date(c.created_at).toLocaleString("es-CL")}
            </small>
          </div>
          <Allocations values={c.allocations} people={config.people} />
          <IconButton
            icon={Eye}
            title={`Ver corte ${c.id}`}
            onClick={() => show(c.id)}
          />
          {c.id === last && (
            <IconButton
              icon={Undo2}
              title="Anular último corte"
              disabled={busy}
              onClick={() => cancel(c.id)}
            />
          )}
        </div>
      ))}
      {!history.length && (
        <p className="muted">Todavía no hay cortes validados.</p>
      )}
      {confirmation && (
        <Modal
          id="cutConfirm"
          title="Confirmar corte"
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          <p>
            {date(confirmation.plan.start)} a {date(confirmation.plan.end)} ·{" "}
            {confirmation.plan.count} movimientos
          </p>
          <Allocations
            values={confirmation.plan.allocations}
            people={config.people}
          />
          <Field label="Nota">
            <input
              disabled={busy}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <ErrorBox error={error} />
          <div className="dialog-actions">
            <button
              className="primary"
              disabled={busy || !confirmation.plan.count}
              onClick={save}
            >
              <Check />
              Confirmar corte
            </button>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal
          id="cutDetail"
          title={`Corte #${detail.cut.id}${detail.cut.cancelled_at ? " · Anulado" : ""}`}
          onClose={() => setDetail(null)}
        >
          <p>
            {date(detail.cut.start_date)} a {date(detail.cut.end_date)}
          </p>
          <Allocations values={detail.allocations} people={config.people} />
          <p>{detail.cut.note}</p>
          <div className="cut-snapshots">
            {detail.rows.map((r) => (
              <div className="category-row" key={r.id}>
                <div>
                  #{r.id} · {r.description}
                  <small>
                    {r.installment ? month(r.period) : date(r.date)}
                    {r.adjustment ? " · Ajuste" : ""}
                  </small>
                  <small>
                    Categoría al validar: {r.category || "Sin categoría"}
                  </small>
                </div>
                <Allocations
                  values={r.allocations}
                  names={r.people}
                  people={config.people}
                />
              </div>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}
