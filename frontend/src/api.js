let token = "";
export function scoped(path) {
  const url = new URL(path, location.origin);
  const household = new URLSearchParams(location.search).get("household");
  if (household) url.searchParams.set("household", household);
  return url.pathname + url.search;
}
export async function api(path, options = {}) {
  const response = await fetch(scoped(path), {
    ...options,
    headers: { "X-Cuentas-Token": token, ...options.headers },
  });
  const data = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event("session-expired"));
  if (!response.ok)
    throw new Error(data.error || "No se pudo completar la solicitud");
  if (path === "/api/config" || path === "/api/session") token = data.token;
  return data;
}
export const post = (path, data) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
export async function download(filters) {
  const response = await fetch(
    scoped("/api/export-filtered?" + new URLSearchParams(filters)),
  );
  if (!response.ok)
    throw new Error((await response.json()).error || "No se pudo descargar");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download =
    response.headers
      .get("Content-Disposition")
      ?.match(/filename="([^"]+)"/)?.[1] || "movimientos.xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
