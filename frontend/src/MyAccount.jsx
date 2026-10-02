import { useState } from "react";
import { Save, KeyRound, UserRoundX } from "lucide-react";
import { post } from "./api";
import { ErrorBox, Field } from "./ui";

export default function MyAccount({ account }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event, action) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setError("");
    setMessage("");
    if (action === "password" && values.new_password !== values.confirmation) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    if (
      action === "delete" &&
      !confirm(
        "¿Eliminar tu acceso? Se cerrarán todas tus sesiones. Los gastos e integrantes se conservarán en los hogares.",
      )
    )
      return;
    setBusy(true);
    try {
      const result = await post("/api/account", { ...values, action });
      if (result.signed_out) {
        location.assign(
          "/?account=" + (action === "delete" ? "deleted" : "password-changed"),
        );
        return;
      }
      await account.refresh();
      setMessage("Nombre de la cuenta actualizado.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="my-account">
      <ErrorBox error={error} />
      {message && <p role="status">{message}</p>}
      <section>
        <h2>Datos de la cuenta</h2>
        <form onSubmit={(e) => submit(e, "profile")}>
          <fieldset disabled={busy}>
            <Field label="Nombre de la cuenta">
              <input
                name="name"
                defaultValue={account.user.name}
                required
                maxLength={160}
                autoComplete="name"
              />
            </Field>
            <Field label="Correo de acceso">
              <input
                type="email"
                value={account.user.email}
                readOnly
                autoComplete="username"
              />
            </Field>
            <button className="primary">
              <Save />
              Guardar nombre
            </button>
          </fieldset>
        </form>
      </section>
      <section>
        <h2>Cambiar contraseña</h2>
        <p>
          Se cerrarán todas tus sesiones. La nueva contraseña debe tener entre
          12 y 256 caracteres.
        </p>
        <form onSubmit={(e) => submit(e, "password")}>
          <fieldset disabled={busy}>
            <Field label="Contraseña actual">
              <input
                name="current_password"
                type="password"
                required
                maxLength={256}
                autoComplete="current-password"
              />
            </Field>
            <Field label="Nueva contraseña">
              <input
                name="new_password"
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Repetir nueva contraseña">
              <input
                name="confirmation"
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
              />
            </Field>
            <button className="primary">
              <KeyRound />
              Cambiar contraseña
            </button>
          </fieldset>
        </form>
      </section>
      <section>
        <h2>Eliminar cuenta</h2>
        <p>
          Se desactivará tu acceso y tu participación en los hogares. Los
          gastos, las personas y el historial se conservarán. No se borrarán tus
          datos personales ni podrás volver a registrarte con este correo.
        </p>
        <p>
          Debes dejar otro administrador en cada hogar que administras,
          incluidos los archivados. Esta acción no tiene recuperación desde el
          sistema.
        </p>
        <form onSubmit={(e) => submit(e, "delete")}>
          <fieldset disabled={busy}>
            <Field label="Contraseña actual para eliminar">
              <input
                name="current_password"
                type="password"
                required
                maxLength={256}
                autoComplete="current-password"
              />
            </Field>
            <Field label="Escribe ELIMINAR">
              <input
                name="confirmation"
                required
                pattern="ELIMINAR"
                autoComplete="off"
              />
            </Field>
            <button className="danger">
              <UserRoundX />
              Eliminar cuenta
            </button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
