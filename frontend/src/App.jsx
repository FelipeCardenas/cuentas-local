import { useCallback, useEffect, useRef, useState } from "react";
import {
  WalletCards,
  CreditCard,
  ListChecks,
  Inbox,
  History,
  Tags,
  Users,
  ChartNoAxesCombined,
  Download,
  Plus,
  ArrowRight,
  FileSpreadsheet,
  Home,
  LogOut,
  UserRound,
} from "lucide-react";
import { api, post, scoped } from "./api";
import { Households, openHome } from "./Accounts";
import { batchLabel, emptyFilters } from "./domain";
import { ErrorBox } from "./ui";
import Ledger from "./Ledger";
import Review from "./Review";
import ImportDialog from "./Import";
import Categories from "./Categories";
import Cuts from "./Cuts";
import Statistics from "./Statistics";
import MyAccount from "./MyAccount";
const views = [
  ["review", "Revisión", "Revisión de gastos", ListChecks],
  ["imports", "Importaciones", "Archivos importados", Inbox],
  ["history", "Histórico", "Histórico de movimientos", History],
  ["categories", "Categorías", "Maestro de categorías", Tags],
  ["cuts", "Cuentas del hogar", "Cuentas del hogar", Users],
  ["statistics", "Estadísticas", "Estadísticas de gastos", ChartNoAxesCombined],
  ["households", "Hogares y personas", "Hogares y personas", Home],
];
export default function App({ account }) {
  const [config, setConfig] = useState(null),
    [view, setView] = useState(() =>
      ["households", "account"].includes(
        new URLSearchParams(location.search).get("view"),
      )
        ? new URLSearchParams(location.search).get("view")
        : "review",
    ),
    [filters, setFilters] = useState(emptyFilters),
    [revision, setRevision] = useState(0),
    [review, setReview] = useState(null),
    [importing, setImporting] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [count, setCount] = useState(null);
  const timer = useRef();
  useEffect(() => {
    let active = true;
    api("/api/config")
      .then((c) => {
        if (active) {
          setConfig(c);
          setFilters((f) => ({ ...f, batch: String(c.batches[0]?.id || "") }));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      clearTimeout(timer.current);
    };
  }, []);
  const changed = useCallback(async (message) => {
    // A completed mutation remains completed even when refreshing configuration fails.
    try {
      setConfig(await api("/api/config"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
    setRevision((r) => r + 1);
    if (message) {
      setToast(message);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(""), 4500);
    }
  }, []);
  function navigate(next) {
    setView(next);
    const url = new URL(location.href);
    if (["households", "account"].includes(next))
      url.searchParams.set("view", next);
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
    if (next === "history") setFilters((f) => ({ ...f, batch: "", state: "" }));
    if (next === "review") setFilters((f) => ({ ...f, state: "pendiente" }));
  }
  function history(category) {
    setFilters({ ...emptyFilters(), state: "", category });
    setView("history");
  }
  const current =
    view === "account"
      ? ["account", "Mi cuenta", "Mi cuenta"]
      : views.find((v) => v[0] === view);
  return (
    <>
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brandmark">
            <WalletCards />
          </span>
          Cuentas<span className="local">LOCAL</span>
        </a>
        <div className="workspace">FINANZAS PERSONALES</div>
        <label className="household-selector">
          Hogar
          <select
            aria-label="Hogar activo"
            disabled={review !== null || importing}
            value={
              config?.household.id ||
              new URLSearchParams(location.search).get("household") ||
              ""
            }
            onChange={(e) => openHome(e.target.value)}
          >
            {account.homes.map((h) => (
              <option value={h.id} key={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Navegación principal">
          {views.map(([id, label, , Icon]) => (
            <button
              key={id}
              className={"nav " + (view === id ? "active" : "")}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon />
              {label}
              {id === "review" && count !== null && <span>{count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="account-link"
            aria-label="Mi cuenta"
            aria-current={view === "account" ? "page" : undefined}
            onClick={() => navigate("account")}
          >
            <UserRound />
            <span>
              {account.user.name}
              <small>{config?.household.name}</small>
            </span>
          </button>
          <button
            className="icon-button"
            title="Cerrar sesión"
            onClick={async () => {
              if (
                confirm("¿Cerrar sesión? Los cambios sin guardar se perderán.")
              ) {
                try {
                  await post("/api/logout", {});
                  location.assign("/");
                } catch (e) {
                  setError(e.message);
                }
              }
            }}
          >
            <LogOut />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Mis cuentas <span>/</span>
            <b>{current[1]}</b>
          </div>
          <div className="bank">
            <CreditCard />
            CMR <span>Banco Falabella</span>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">
                {view === "account" ? "CUENTA PERSONAL" : "MOVIMIENTOS"}
              </div>
              <h1>{current[2]}</h1>
            </div>
            {["review", "history", "imports"].includes(view) && (
              <div className="heading-actions">
                <a
                  className="button secondary"
                  href={scoped("/api/export?confirmed=1")}
                  title="Descargar gastos confirmados"
                >
                  <Download />
                  <span>Exportar confirmados</span>
                </a>
                <button
                  className="primary"
                  disabled={!config}
                  onClick={() => setImporting(true)}
                >
                  <Plus />
                  Importar Excel
                </button>
              </div>
            )}
          </div>
          <ErrorBox error={error} />
          {view === "account" && <MyAccount account={account} />}
          {!config && !error && <p role="status">Cargando…</p>}
          {config && (
            <>
              {["review", "history"].includes(view) && (
                <Ledger
                  {...{ config, filters, setFilters, revision }}
                  onReview={setReview}
                  onChanged={changed}
                  onCount={setCount}
                />
              )}
              {view === "imports" && (
                <section>
                  <div className="section-heading">
                    <h2>{config.batches.length} importaciones</h2>
                  </div>
                  {config.batches.map((b) => (
                    <div className="batch-row" key={b.id}>
                      <span className="batch-icon">
                        <FileSpreadsheet />
                      </span>
                      <div className="batch-info">
                        <strong>{batchLabel(b)}</strong>
                        <small>
                          {new Date(b.imported_at).toLocaleString("es-CL")}
                        </small>
                      </div>
                      <span className="batch-number">
                        {b.count} movimientos
                      </span>
                      <button
                        className="secondary"
                        onClick={() => {
                          setFilters({
                            ...emptyFilters(),
                            batch: String(b.id),
                          });
                          setView("review");
                        }}
                      >
                        Revisar
                        <ArrowRight />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {view === "categories" && (
                <Categories
                  revision={revision}
                  onChanged={changed}
                  onHistory={history}
                />
              )}
              {view === "cuts" && (
                <Cuts
                  config={config}
                  revision={revision}
                  onChanged={changed}
                  onReview={setReview}
                />
              )}
              {view === "statistics" && <Statistics revision={revision} />}
              {view === "households" && (
                <Households
                  account={account}
                  config={config}
                  onChanged={changed}
                />
              )}
              {review !== null && (
                <Review
                  key={review}
                  id={review}
                  config={config}
                  onClose={() => setReview(null)}
                  onChanged={changed}
                />
              )}
              {importing && (
                <ImportDialog
                  onClose={() => setImporting(false)}
                  onImported={async (d) => {
                    await changed(
                      d.reutilizado
                        ? "Archivo reconocido. No se agregaron movimientos."
                        : `Importación completada · ${d.reconocidos || 0} reconocidos · ${d.nuevos ?? d.movimientos} nuevos`,
                    );
                    setFilters({ ...emptyFilters(), batch: String(d.lote) });
                    setView("review");
                    setImporting(false);
                  }}
                />
              )}
            </>
          )}
        </div>
      </main>
      {toast && (
        <div id="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
