import { useState } from "react";
import { Plus, Pencil, Merge, Trash2, ListFilter } from "lucide-react";
import { useQuery, Status, IconButton, Modal, Field, ErrorBox } from "./ui";
import { post } from "./api";
export default function Categories({ revision, onChanged, onHistory }) {
  const query = useQuery("/api/categories", revision),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState(null),
    [name, setName] = useState(""),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const rows = query.data || [];
  function open(action, row) {
    setEdit({ action, row });
    setName(row?.name || "");
    setTarget("");
    setError("");
  }
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await post("/api/categories", {
        action: edit.action,
        id: edit.row?.id,
        original: edit.row?.name,
        name,
        target: Number(target),
      });
      await onChanged("Maestro de categorías actualizado");
      setEdit(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const titles = {
    add: "Agregar categoría",
    rename: "Renombrar categoría",
    merge: "Fusionar categoría",
    delete: "Eliminar categoría",
  };
  return (
    <section id="categoryPanel">
      <Status {...query} />
      <div className="section-heading">
        <h2>{rows.length} categorías</h2>
        <button className="primary" onClick={() => open("add")}>
          <Plus />
          Agregar categoría
        </button>
      </div>
      <Field label="Buscar categoría">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Field>
      {rows
        .filter((c) =>
          c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .map((c) => (
          <div key={c.id} className="category-row">
            <div>
              <strong>{c.name}</strong>
              <small>{c.count} movimientos</small>
            </div>
            <div className="category-tools">
              <IconButton
                icon={ListFilter}
                title={`Ver movimientos de ${c.name}`}
                onClick={() => onHistory(c.name)}
              />
              <IconButton
                icon={Pencil}
                title={`Renombrar ${c.name}`}
                onClick={() => open("rename", c)}
              />
              <IconButton
                icon={Merge}
                title={`Fusionar ${c.name}`}
                onClick={() => open("merge", c)}
              />
              <IconButton
                icon={Trash2}
                title={`Eliminar ${c.name}`}
                onClick={() => open("delete", c)}
              />
            </div>
          </div>
        ))}
      {edit && (
        <Modal
          id="categoryDialog"
          title={titles[edit.action]}
          onClose={() => setEdit(null)}
          busy={busy}
        >
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              {edit.row && (
                <p>
                  <b>{edit.row.name}</b> · {edit.row.count} movimientos
                </p>
              )}
              {["add", "rename"].includes(edit.action) ? (
                <Field label="Nombre">
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
              ) : edit.action === "merge" ? (
                <>
                  <Field label="Categoría de destino">
                    <select
                      required
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {rows
                        .filter((c) => c.id !== edit.row.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <p>
                    Se reasignarán todos sus movimientos. No cambiarán los
                    montos ni el reparto.
                  </p>
                </>
              ) : (
                <p>
                  {edit.row.count
                    ? "Esta categoría tiene movimientos. Debes fusionarla antes de eliminarla."
                    : "Se eliminará esta categoría y sus nombres alternativos."}
                </p>
              )}
              <ErrorBox error={error} />
              <div className="dialog-actions">
                <button
                  className="primary"
                  disabled={edit.action === "delete" && edit.row.count > 0}
                >
                  {edit.action === "delete"
                    ? "Eliminar"
                    : edit.action === "merge"
                      ? "Fusionar y reasignar"
                      : "Guardar"}
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
    </section>
  );
}
