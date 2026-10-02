import { useState } from "react";
import { FileSpreadsheet, Upload, ScanLine } from "lucide-react";
import { Modal, Field, ErrorBox } from "./ui";
import { api } from "./api";
import { money, month } from "./domain";
export default function ImportDialog({ onClose, onImported }) {
  const today = new Date();
  const [file, setFile] = useState(null),
    [period, setPeriod] = useState(
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
    ),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function choose(f) {
    setFile(f);
    setPreview(null);
    setError("");
  }
  async function upload(mode) {
    if (busy) return;
    setError("");
    if (
      !file ||
      !file.name.toLowerCase().endsWith(".xlsx") ||
      file.size > 12 * 1024 * 1024
    ) {
      setError("Selecciona un archivo .xlsx de hasta 12 MB.");
      return;
    }
    if (!period) {
      setError("Indica el mes de las cuotas.");
      return;
    }
    setBusy(true);
    try {
      const data = await api(
        "/api/" + mode + "?" + new URLSearchParams({ name: file.name, period }),
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
      if (mode === "preview") setPreview(data);
      else await onImported(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      id="importDialog"
      title="Importar movimientos"
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          upload(preview ? "import" : "preview");
        }}
      >
        <fieldset disabled={busy}>
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) choose(e.dataTransfer.files[0]);
            }}
          >
            <FileSpreadsheet />
            <strong>{file?.name || "Seleccionar archivo Excel"}</strong>
            <span>.xlsx · hasta 12 MB</span>
            <input
              aria-label="Archivo Excel"
              type="file"
              accept=".xlsx"
              onChange={(e) => choose(e.target.files[0])}
            />
          </label>
          <Field label="Mes de las cuotas">
            <input
              type="month"
              required
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPreview(null);
              }}
            />
          </Field>
          {preview && (
            <>
              {preview.existing && (
                <div className="notice">
                  Archivo ya importado · Lote #{preview.existing} ·{" "}
                  {month(preview.existing_period)}
                </div>
              )}
              <div className="preview-stats">
                {[
                  ["Movimientos", preview.count],
                  ["Pagos CMR", preview.payments],
                  ["Cuotas", preview.installments],
                  ["Gasto bruto", money(preview.gross)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              {preview.rows.map((r, i) => (
                <div className="preview-row" key={i}>
                  <span>{r.description}</span>
                  <b>{money(r.amount)}</b>
                </div>
              ))}
            </>
          )}
          <ErrorBox error={error} />
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="primary">
              {preview ? <Upload /> : <ScanLine />}
              {busy
                ? "Procesando…"
                : preview
                  ? preview.existing
                    ? "Abrir importación existente"
                    : "Confirmar importación"
                  : "Revisar archivo"}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
