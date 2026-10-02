import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./api";
import { states } from "./domain";

export function useQuery(path, revision = 0) {
  const [result, setResult] = useState({
    data: null,
    error: "",
    loading: true,
  });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setResult({ data: null, error: "", loading: !!path });
    if (path)
      api(path, { signal: controller.signal })
        .then((data) => {
          if (active) setResult({ data, error: "", loading: false });
        })
        .catch((e) => {
          if (active && e.name !== "AbortError")
            setResult({ data: null, error: e.message, loading: false });
        });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, revision]);
  return result;
}
export function useGuard(enabled) {
  useEffect(() => {
    const handler = (e) => {
      if (enabled) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled]);
}
export function ErrorBox({ error }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Status({ loading, error }) {
  return (
    <>
      <ErrorBox error={error} />
      {loading && <p role="status">Cargando…</p>}
    </>
  );
}
export function IconButton({ icon: Icon, title, ...props }) {
  return (
    <button
      type="button"
      className="icon"
      title={title}
      aria-label={title}
      {...props}
    >
      <Icon />
    </button>
  );
}
export function Field({ label, children, ...props }) {
  return (
    <label className="field" {...props}>
      {label}
      {isValidElement(children)
        ? cloneElement(children, {
            "aria-label": children.props["aria-label"] || label,
          })
        : children}
    </label>
  );
}
export function Badge({ row }) {
  return (
    <span
      className={
        "badge " +
        (row.state === "aceptado"
          ? "accepted"
          : row.state === "pendiente"
            ? ""
            : "neutral")
      }
    >
      {row.kind === "pago_tarjeta" ? "Fuera del gasto" : states[row.state]}
    </span>
  );
}
export function Metrics({ items, className = "" }) {
  return (
    <section className={"metrics " + className}>
      {items.map(([label, value, note], i) => (
        <div key={i}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{note}</small>
        </div>
      ))}
    </section>
  );
}
export function Modal({ id, title, children, onClose, busy = false }) {
  const ref = useRef();
  useEffect(() => {
    const node = ref.current;
    node.showModal();
    return () => node.close();
  }, []);
  useGuard(busy);
  return (
    <dialog
      id={id}
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <IconButton icon={X} title="Cerrar" disabled={busy} onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
export function Pagination({ page, pages, onChange, count }) {
  return (
    <footer className="pagination">
      <span>
        {count != null ? `${count} movimientos · filtros aplicados` : ""}
      </span>
      <div>
        <IconButton
          icon={ChevronLeft}
          title="Página anterior"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        />
        <span>
          {page} / {pages}
        </span>
        <IconButton
          icon={ChevronRight}
          title="Página siguiente"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        />
      </div>
    </footer>
  );
}
export function SelectAll({ selected, total, onChange }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.indeterminate = selected > 0 && selected < total;
  }, [selected, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Seleccionar todos"
      checked={total > 0 && selected === total}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
