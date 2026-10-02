import { useState } from "react";
import { Save, Check, Split, ArchiveX, Undo2 } from "lucide-react";
import {
  useQuery,
  Modal,
  Status,
  Field,
  ErrorBox,
  Badge,
  useGuard,
} from "./ui";
import { api, post } from "./api";
import { money, date, month, kinds, split, units, decimal } from "./domain";
import Allocations from "./Allocations";

export default function Review({ id, config, onClose, onChanged }) {
  const query = useQuery("/api/detail/" + id);
  if (!query.data)
    return (
      <Modal id="drawer" title="Revisar movimiento" onClose={onClose}>
        <div id="detailBody">
          <Status {...query} />
        </div>
      </Modal>
    );
  return (
    <ReviewForm
      key={id}
      initial={query.data}
      {...{ config, onClose, onChanged }}
    />
  );
}
function ReviewForm({ initial, config, onClose, onChanged }) {
  const [detail, setDetail] = useState(initial),
    [form, setForm] = useState(values(initial.row)),
    [note, setNote] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [candidate, setCandidate] = useState(null);
  const r = detail.row,
    discarded = r.state === "excluido_gasto" && r.kind !== "pago_tarjeta";
  const members = config.people.filter(
    (p) => p.active || Number(r.allocations?.[p.id] || 0) !== 0,
  );
  useGuard(dirty || !!note || busy);
  function close() {
    if (
      !busy &&
      (!(dirty || note) || confirm("Hay cambios sin guardar. ¿Descartarlos?"))
    )
      onClose();
  }
  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setError("");
  }
  function percentage(who, value) {
    try {
      const [a, b] = split(r.amount, value);
      setForm((f) => ({
        ...f,
        allocations: {
          ...f.allocations,
          [who]: a,
          ...(members.length === 2
            ? { [members.find((p) => p.id !== who).id]: b }
            : {}),
        },
      }));
      setDirty(true);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  function equal() {
    const active = members.filter((p) => p.active);
    if (!active.length) return;
    try {
      const total = units(r.amount),
        n = BigInt(active.length),
        part = total / n,
        rest = total - part * n;
      const values = Object.fromEntries(members.map((p) => [p.id, "0"]));
      active.forEach((p, i) => {
        values[p.id] = decimal(
          part +
            (BigInt(i) < (rest < 0n ? -rest : rest)
              ? rest < 0n
                ? -1n
                : 1n
              : 0n),
        );
      });
      set("allocations", values);
    } catch (e) {
      setError(e.message);
    }
  }
  async function submit(action, duplicate_of) {
    if (busy) return;
    if (dirty && !["editar", "aceptar"].includes(action)) {
      setError("Guarda los cambios de categoría y reparto antes de continuar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await post("/api/review", {
        id: r.id,
        version: r.version,
        action,
        note,
        ...(["editar", "aceptar"].includes(action) ? form : {}),
        ...(duplicate_of ? { duplicate_of } : {}),
      });
      setDirty(false);
      await onChanged(
        action === "descartar"
          ? "Movimiento no considerado"
          : action === "restaurar"
            ? "Movimiento devuelto a revisión"
            : "Revisión guardada",
      );
      if (["aceptar", "duplicado", "descartar", "restaurar"].includes(action)) {
        onClose();
        return;
      }
      const next = await api("/api/detail/" + r.id);
      setDetail(next);
      setForm(values(next.row));
      setNote("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  let diff = null;
  try {
    diff =
      Number(
        units(r.amount) -
          members.reduce(
            (s, p) => s + units(form.allocations[p.id] ?? "0"),
            0n,
          ),
      ) / 1e6;
  } catch {}
  return (
    <Modal
      id="drawer"
      title={`Revisar movimiento #${r.id}`}
      busy={busy}
      onClose={close}
    >
      <div id="detailBody">
        <h3 className="detail-description">{r.description}</h3>
        <div className="detail-meta">
          {date(r.purchase_date)} · {kinds[r.kind]} · {r.holder}
        </div>
        <div className="detail-amount">{money(r.amount)}</div>
        <Badge row={r} />
        {r.kind === "pago_tarjeta" && (
          <div className="notice">Pago de deuda · excluido del gasto.</div>
        )}
        {r.state === "duplicado" && (
          <div className="notice">
            Vinculado al movimiento #{r.duplicate_of}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit("editar");
          }}
        >
          <fieldset disabled={busy}>
            <Field label="Categoría">
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="">Sin categoría</option>
                {config.categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Período">
              <input
                type="month"
                required
                value={form.period}
                onChange={(e) => set("period", e.target.value)}
              />
            </Field>
            <div className="split-grid percentages">
              {members.map(({ id: w, name }) => (
                <Field key={w} label={`${name} · %`}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={
                      form.allocations[w] !== "" && Number(r.amount) !== 0
                        ? Math.round(
                            (Number(form.allocations[w] || 0) /
                              Number(r.amount)) *
                              10000,
                          ) / 100
                        : ""
                    }
                    onChange={(e) => percentage(w, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            <div className="split-grid">
              {members.map(({ id: w, name, active }) => (
                <Field
                  key={w}
                  label={`${name}${active ? "" : " (retirado)"} · CLP`}
                >
                  <input
                    type="number"
                    step="0.000001"
                    value={form.allocations[w] ?? "0"}
                    onChange={(e) =>
                      set("allocations", {
                        ...form.allocations,
                        [w]: e.target.value,
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <div className="split-toolbar">
              <span>
                {diff === null
                  ? "Reparto incompleto"
                  : form.special_case
                    ? `Caso especial · diferencia: ${money(diff)}`
                    : diff === 0
                      ? "Reparto completo"
                      : `Por asignar: ${money(diff)}`}
              </span>
              <button type="button" className="secondary" onClick={equal}>
                <Split />
                Partes iguales
              </button>
            </div>
            <label className="special-toggle">
              <input
                type="checkbox"
                checked={form.special_case}
                onChange={(e) => set("special_case", e.target.checked)}
              />
              Caso especial · permitir un reparto distinto del total
            </label>
            <Field label="Nota de revisión">
              <input
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <ErrorBox error={error} />
            <div className="detail-actions">
              <button
                className="secondary"
                disabled={
                  discarded ||
                  r.state === "duplicado" ||
                  r.kind === "pago_tarjeta"
                }
              >
                <Save />
                Guardar
              </button>
              <button
                type="button"
                className="primary"
                disabled={discarded || r.kind === "pago_tarjeta"}
                onClick={(e) => {
                  if (e.currentTarget.form.reportValidity()) submit("aceptar");
                }}
              >
                <Check />
                {r.state === "duplicado"
                  ? "Restituir y confirmar"
                  : "Confirmar"}
              </button>
            </div>
            {r.kind !== "pago_tarjeta" && r.state !== "duplicado" && (
              <button
                type="button"
                className="secondary discard-action"
                onClick={() => {
                  if (
                    confirm(
                      discarded
                        ? "¿Volver a dejar este movimiento pendiente?"
                        : "¿No considerar este movimiento? Podrás recuperarlo en Descartados.",
                    )
                  )
                    submit(discarded ? "restaurar" : "descartar");
                }}
              >
                {discarded ? <Undo2 /> : <ArchiveX />}
                {discarded ? "Volver a revisión" : "No considerar"}
              </button>
            )}
          </fieldset>
        </form>
        {!!detail.candidates.length && (
          <section className="detail-section">
            <h3>Posibles coincidencias · {detail.candidates.length}</h3>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => submit("conservar")}
            >
              Es una compra independiente
            </button>
            {detail.candidates.map((c) => (
              <div className="candidate" key={c.id}>
                <div>
                  #{c.id} · Lote {c.batch_id} · {date(c.purchase_date)}
                </div>
                <p>
                  {c.description} · <b>{money(c.amount)}</b>
                </p>
                <p>{c.category || "Sin categoría"}</p>
                <Allocations values={c.allocations} people={config.people} />
                <div className="candidate-actions">
                  <Badge row={c} />
                  <button
                    disabled={busy}
                    className="secondary"
                    onClick={() => setCandidate(c)}
                  >
                    Ver
                  </button>
                  <button
                    disabled={busy || c.state !== "aceptado"}
                    className="secondary"
                    onClick={() => {
                      if (confirm(`¿Vincular como duplicado de #${c.id}?`))
                        submit("duplicado", c.id);
                    }}
                  >
                    Vincular como duplicado
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
        {!!detail.issues.length && (
          <section className="detail-section">
            <h3>Avisos por revisar</h3>
            {detail.issues.map((i, n) => (
              <div className="notice" key={n}>
                {i.detail}
              </div>
            ))}
          </section>
        )}
        <section className="detail-section">
          <h3>Datos de origen</h3>
          {detail.observations.map((o, i) => (
            <details className="observation" key={i}>
              <summary>
                {o.source_key} · fila {o.row_number}
              </summary>
              <dl className="kv">
                {Object.entries(parse(o.raw_json)).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{String(v ?? "—")}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </section>
        {!!detail.decisions.length && (
          <section className="detail-section">
            <h3>Revisiones guardadas</h3>
            {detail.decisions.map((d, i) => (
              <div className="observation" key={i}>
                <b>{d.action}</b> ·{" "}
                {new Date(d.created_at).toLocaleString("es-CL")}
                <div>{d.note}</div>
              </div>
            ))}
          </section>
        )}
        {candidate && (
          <Modal
            title={`Movimiento #${candidate.id}`}
            onClose={() => setCandidate(null)}
          >
            <p>{candidate.description}</p>
            <p>
              {date(candidate.purchase_date)} · {month(candidate.period)}
            </p>
            <p>{candidate.category}</p>
            <p>{money(candidate.amount)}</p>
            <Allocations
              values={candidate.allocations}
              people={config.people}
            />
            <Badge row={candidate} />
          </Modal>
        )}
      </div>
    </Modal>
  );
}
function values(r) {
  return {
    category: r.category || "",
    period: r.period,
    allocations: r.allocations || {},
    special_case: !!r.special_case,
  };
}
function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
