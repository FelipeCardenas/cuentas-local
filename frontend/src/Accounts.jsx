import { useEffect, useRef, useState } from "react";
import {
  WalletCards,
  LogIn,
  LogOut,
  UserPlus,
  Home,
  Plus,
  Copy,
  Pencil,
  Check,
  X,
  UserMinus,
  UserCheck,
  Archive,
  RotateCcw,
  ListChecks,
} from "lucide-react";
import { api, post } from "./api";
import { ErrorBox, Field, Modal, IconButton, useQuery, Status } from "./ui";
import App from "./App";
import MyAccount from "./MyAccount";

export function openHome(id, view = "review") {
  const params = new URLSearchParams();
  if (id) params.set("household", id);
  if (["households", "account"].includes(view)) params.set("view", view);
  location.assign("/" + (params.size ? "?" + params : ""));
}

export default function Accounts() {
  const [session, setSession] = useState(null),
    [error, setError] = useState("");
  async function refresh() {
    const data = await api("/api/session");
    const chosen = new URLSearchParams(location.search).get("household");
    const view = new URLSearchParams(location.search).get("view");
    if (
      data.user &&
      data.homes.length &&
      !data.homes.some((h) => h.id === chosen)
    ) {
      openHome(data.homes[0].id, view);
      return;
    }
    if (data.user && chosen && !data.homes.length) {
      openHome(null, view);
      return;
    }
    setSession(data);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const expired = () => {
      setSession(null);
      refresh().catch((e) => setError(e.message));
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  if (!session)
    return (
      <div className="account-page">
        <ErrorBox error={error} />
        <p role="status">Cargando...</p>
      </div>
    );
  if (!session.user)
    return <SignIn setup={session.setup} onDone={() => openHome(null)} />;
  const account = { ...session, refresh };
  if (
    !session.homes.length &&
    new URLSearchParams(location.search).get("view") === "account"
  )
    return (
      <div className="account-page">
        <a href="/?view=households">Mis hogares</a>
        <h1>Mi cuenta</h1>
        <MyAccount account={account} />
      </div>
    );
  if (!session.homes.length)
    return (
      <div className="account-page">
        <h1>Mis hogares</h1>
        <Households account={account} />
      </div>
    );
  return <App account={account} />;
}

function SignIn({ setup, onDone }) {
  const [register, setRegister] = useState(setup),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await post(register ? "/api/register" : "/api/login", values);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-page signin">
      <div className="brand">
        <WalletCards />
        Cuentas<span className="local">LOCAL</span>
      </div>
      <h1>
        {setup
          ? "Configurar cuenta administradora"
          : register
            ? "Crear cuenta"
            : "Iniciar sesión"}
      </h1>
      {new URLSearchParams(location.search).get("account") ===
        "password-changed" && (
        <p role="status">
          Contraseña actualizada. Inicia sesión con tu nueva contraseña.
        </p>
      )}
      {new URLSearchParams(location.search).get("account") === "deleted" && (
        <p role="status">
          Tu cuenta ha sido desactivada. El historial de los hogares se
          conserva.
        </p>
      )}
      {setup && (
        <p className="notice">
          La primera cuenta administrará los datos existentes de este equipo.
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {register && (
            <Field label="Nombre de la cuenta">
              <input name="name" required maxLength={160} autoComplete="name" />
            </Field>
          )}
          <Field label="Correo">
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="username"
            />
          </Field>
          <Field label="Contraseña">
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </Field>
          <ErrorBox error={error} />
          <button className="primary">
            {register ? <UserPlus /> : <LogIn />}
            {register ? "Crear cuenta" : "Ingresar"}
          </button>
          {!setup && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Ya tengo una cuenta" : "Crear una cuenta"}
            </button>
          )}
        </fieldset>
      </form>
    </div>
  );
}

export function Households({ account, config, onChanged }) {
  const [revision, setRevision] = useState(0),
    [homeTab, setHomeTab] = useState("active"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState(null);
  const inFlight = useRef(false);
  const query = useQuery(config ? "/api/household" : null, revision);
  const detail = query.data,
    admin = !!detail?.home.admin;
  const archivedHomes = (account.home_history || []).filter(
    (h) => h.archived_at,
  );
  async function act(data) {
    if (inFlight.current) return;
    inFlight.current = true;
    let navigating = false;
    setBusy(true);
    setError("");
    try {
      const result = await post("/api/households", data);
      if (data.action === "create") {
        navigating = true;
        setEditor(null);
        openHome(result.id, "households");
        return;
      }
      setEditor(null);
      setRevision((n) => n + 1);
      await account.refresh();
      if (onChanged) await onChanged("Hogar actualizado");
    } catch (e) {
      setError(e.message);
    } finally {
      if (!navigating) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  function submit(e, action, extra = {}) {
    e.preventDefault();
    act({
      ...Object.fromEntries(new FormData(e.currentTarget)),
      action,
      ...extra,
    });
  }
  return (
    <section className="household-panel">
      <ErrorBox error={error} />
      {config && <Status {...query} />}
      {!config && (
        <div className="section-heading">
          <button
            className="secondary"
            onClick={() => openHome(null, "account")}
            aria-label="Mi cuenta"
          >
            {account.user.name}
          </button>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await post("/api/logout", {});
                location.assign("/");
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <LogOut />
            Cerrar sesión
          </button>
        </div>
      )}
      <div className="section-heading">
        <h2>Hogares</h2>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            setEditor({ action: "create", request_id: crypto.randomUUID() })
          }
        >
          <Plus />
          Crear hogar
        </button>
      </div>
      <div
        className="tabs household-tabs"
        role="tablist"
        aria-label="Estado de hogares"
      >
        {[
          ["active", "Activos"],
          ["archived", "Archivados"],
        ].map(([id, label]) => (
          <button
            key={id}
            id={`homes-tab-${id}`}
            role="tab"
            aria-selected={homeTab === id}
            aria-controls={`homes-panel-${id}`}
            tabIndex={homeTab === id ? 0 : -1}
            className={homeTab === id ? "selected" : ""}
            onClick={() => setHomeTab(id)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? "active"
                    : e.key === "End"
                      ? "archived"
                      : id === "active"
                        ? "archived"
                        : "active";
                setHomeTab(next);
                document.getElementById(`homes-tab-${next}`).focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <section
        id="homes-panel-active"
        role="tabpanel"
        aria-labelledby="homes-tab-active"
        hidden={homeTab !== "active"}
      >
        <div className="household-list">
          {account.homes.map((h) => (
            <div className="household-row" key={h.id}>
              <button
                className="secondary"
                disabled={busy || h.id === config?.household.id}
                onClick={() => openHome(h.id, "households")}
              >
                <Home />
                {h.name}
              </button>
              <div className="household-info">
                <span>{h.address || "Dirección pendiente"}</span>
                <small className="person-id">ID: {h.id}</small>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => openHome(h.id)}
                aria-label={`Ir a Revisión de ${h.name} (${h.id})`}
              >
                <ListChecks />
                Ir a Revisión
              </button>
              <IconButton
                icon={Archive}
                title={`Archivar ${h.name} (${h.id})`}
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `¿Archivar ${h.name} para tu cuenta? No se borrarán gastos ni se afectará a otros integrantes. Podrás reactivarlo desde el historial.`,
                    )
                  )
                    act({ action: "archive_home", home_id: h.id });
                }}
              />
            </div>
          ))}
        </div>
        {!account.homes.length && <p className="muted">Sin hogares activos.</p>}
      </section>
      <section
        className="household-history"
        id="homes-panel-archived"
        role="tabpanel"
        aria-labelledby="homes-tab-archived"
        hidden={homeTab !== "archived"}
      >
        {archivedHomes.map((h) => (
          <div className="household-row" key={h.id}>
            <div className="household-info">
              <strong>{h.name}</strong>
              <span>{h.address || "Dirección pendiente"}</span>
              <small className="person-id">ID: {h.id}</small>
              <small>
                Creado:{" "}
                {h.created_at
                  ? new Date(h.created_at).toLocaleString("es-CL")
                  : "Sin fecha registrada"}
              </small>
              {h.archived_at && (
                <small>
                  Archivado: {new Date(h.archived_at).toLocaleString("es-CL")}
                </small>
              )}
            </div>
            <span className="badge neutral">
              {h.archived_at ? "Archivado" : "Activo"}
            </span>
            {h.archived_at && (
              <IconButton
                icon={RotateCcw}
                title={`Reactivar ${h.name} (${h.id})`}
                disabled={busy}
                onClick={() => act({ action: "restore_home", home_id: h.id })}
              />
            )}
          </div>
        ))}
        {!archivedHomes.length && (
          <p className="muted">Sin hogares archivados.</p>
        )}
      </section>
      {detail && (
        <>
          <div className="section-heading">
            <div>
              <h2>{detail.home.name}</h2>
              <p>{detail.home.address || "Dirección pendiente"}</p>
            </div>
            {admin && (
              <IconButton
                icon={Pencil}
                title="Editar hogar"
                onClick={() =>
                  setEditor({ ...detail.home, action: "edit_home" })
                }
              />
            )}
          </div>
          <div className="section-heading">
            <h2>Integrantes</h2>
            {admin && (
              <button
                className="secondary"
                onClick={() => setEditor({ action: "add_person" })}
              >
                <UserPlus />
                Agregar persona
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>ID</th>
                  <th>Acceso</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.alias || `${p.name} ${p.surname}`}</strong>
                      <small>{p.alias && `${p.name} ${p.surname}`}</small>
                    </td>
                    <td>
                      <code className="person-id">{p.id}</code>
                      <IconButton
                        icon={Copy}
                        title={`Copiar ID de ${p.name}`}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(p.id);
                          } catch {
                            setError("No se pudo copiar el ID");
                          }
                        }}
                      />
                    </td>
                    <td>
                      {admin && p.linked ? (
                        <select
                          aria-label={`Rol de ${p.name}`}
                          value={p.role}
                          disabled={busy}
                          onChange={(e) =>
                            act({
                              action: "membership",
                              person_id: p.id,
                              role: e.target.value,
                            })
                          }
                        >
                          <option value="member">Integrante</option>
                          <option value="admin">Administrador</option>
                        </select>
                      ) : p.role === "admin" ? (
                        "Administrador"
                      ) : p.linked ? (
                        "Integrante"
                      ) : (
                        "Sin cuenta"
                      )}
                    </td>
                    <td>{p.active ? "Activo" : "Retirado"}</td>
                    <td>
                      {admin && (
                        <>
                          <IconButton
                            icon={Pencil}
                            title={`Editar ${p.name}`}
                            disabled={busy}
                            onClick={() =>
                              setEditor({
                                ...p,
                                person_id: p.id,
                                action: "edit_person",
                              })
                            }
                          />
                          <IconButton
                            icon={p.active ? UserMinus : UserCheck}
                            title={`${p.active ? "Retirar" : "Reincorporar"} a ${p.name}`}
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  p.active
                                    ? `¿Retirar a ${p.name}? Perderá acceso por esta ficha. Sus gastos históricos se conservarán.`
                                    : `¿Reincorporar a ${p.name}?`,
                                )
                              )
                                act({
                                  action: "membership",
                                  person_id: p.id,
                                  active: !p.active,
                                });
                            }}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {admin && (
            <>
              <h2>Solicitudes de vinculación</h2>
              {!detail.claims.length && (
                <p className="muted">Sin solicitudes pendientes</p>
              )}
              {detail.claims.map((c) => (
                <div className="category-row" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <small>{c.email}</small>
                    <code className="person-id">{c.person_id}</code>
                    <small>
                      {detail.people.find((p) => p.id === c.person_id)?.name}
                    </small>
                  </div>
                  <IconButton
                    icon={Check}
                    title={`Aprobar solicitud de ${c.name}`}
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `¿Vincular esta ficha a ${c.email}? Tendrá acceso a los gastos del hogar.`,
                        )
                      )
                        act({ action: "approve", claim_id: c.id });
                    }}
                  />
                  <IconButton
                    icon={X}
                    title={`Rechazar solicitud de ${c.name}`}
                    disabled={busy}
                    onClick={() => act({ action: "reject", claim_id: c.id })}
                  />
                </div>
              ))}
            </>
          )}
        </>
      )}
      <h2>Vincular mi cuenta a una persona</h2>
      <form className="claim-form" onSubmit={(e) => submit(e, "claim")}>
        <Field label="ID de persona">
          <input name="person_id" required maxLength={160} />
        </Field>
        <button className="secondary" disabled={busy}>
          <UserCheck />
          Solicitar vinculación
        </button>
      </form>
      {account.claims.map((c) => (
        <p key={c.id}>
          <code className="person-id">{c.person_id}</code> ·{" "}
          {
            {
              pending: "Pendiente de aprobación",
              approved: "Aprobada",
              rejected: "Rechazada",
            }[c.status]
          }
        </p>
      ))}
      <h2>Mis identidades vinculadas</h2>
      {account.links.map((p, i) => (
        <p key={`${p.id}-${i}`}>
          {p.alias || p.name} · {p.household} ·{" "}
          {p.active ? "Activo" : "Retirado"}
          <br />
          <code className="person-id">{p.id}</code>
        </p>
      ))}
      {editor && (
        <Modal
          title={
            editor.action === "create"
              ? "Crear hogar"
              : editor.action === "edit_home"
                ? "Editar hogar"
                : editor.action === "add_person"
                  ? "Agregar persona"
                  : "Editar persona"
          }
          busy={busy}
          onClose={() => setEditor(null)}
        >
          <form
            onSubmit={(e) =>
              submit(
                e,
                editor.action,
                editor.person_id
                  ? { person_id: editor.person_id }
                  : editor.request_id
                    ? { request_id: editor.request_id }
                    : {},
              )
            }
          >
            <fieldset disabled={busy}>
              <Field label="Nombre">
                <input
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={editor.name || ""}
                />
              </Field>
              {["create", "edit_home"].includes(editor.action) ? (
                <Field label="Dirección">
                  <input
                    name="address"
                    required
                    maxLength={500}
                    defaultValue={editor.address || ""}
                  />
                </Field>
              ) : (
                <>
                  <Field label="Apellido">
                    <input
                      name="surname"
                      maxLength={160}
                      defaultValue={editor.surname || ""}
                    />
                  </Field>
                  <Field label="Seudónimo">
                    <input
                      name="alias"
                      maxLength={160}
                      defaultValue={editor.alias || ""}
                    />
                  </Field>
                  <Field label="Correo de contacto (opcional)">
                    <input
                      name="contact_email"
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      defaultValue={editor.contact_email || ""}
                    />
                  </Field>
                </>
              )}
              <ErrorBox error={error} />
              <button className="primary">
                <Check />
                Guardar
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
    </section>
  );
}
