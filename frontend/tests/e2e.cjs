const { chromium, expect } = require("@playwright/test");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const root = path.resolve(__dirname, "../..");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cuentas-react-"));
const python = process.env.PYTHON || "python";
const screenshots = path.join(root, "work", "react-qa");
fs.mkdirSync(screenshots, { recursive: true });
let server, browser, page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const seed = spawnSync(python, [path.join(__dirname, "seed.py"), folder], {
    encoding: "utf8",
  });
  if (seed.status !== 0) throw Error(seed.stderr);
  const port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(
    python,
    [
      path.join(root, "cuentas", "servidor.py"),
      "--db",
      path.join(folder, "test.sqlite3"),
      "--port",
      String(port),
    ],
    { stdio: "pipe" },
  );
  let logs = "";
  server.stderr.on("data", (b) => (logs += b));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/api/session")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(100);
  }
  if (!ready) throw Error(logs || "Server failed to start");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Browser:", e.message);
  });
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.getByLabel("Nombre de la cuenta", { exact: true }).fill("Ana");
  await page.getByLabel("Correo", { exact: true }).fill("ana@example.test");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("Una clave ficticia 123");
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Revisión de gastos", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pagination")).toContainText("40 movimientos");
  await page
    .getByRole("button", { name: "Página siguiente", exact: true })
    .click();
  await expect(page.locator(".pagination")).toContainText("2 / 2");
  // Review exact allocations, save then accept.
  await page.getByPlaceholder("Buscar movimiento").fill("Pendiente ejemplo 00");
  await page
    .getByRole("button", { name: "Revisar movimiento 22", exact: true })
    .click();
  await expect(page.getByLabel("Ana · CLP", { exact: true })).toHaveValue(
    "4448.5",
  );
  await page.getByLabel("Ana · CLP", { exact: true }).fill("10");
  await page.getByLabel("Amor · CLP", { exact: true }).fill("8887");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByText("Revisiones guardadas", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.locator("#drawer")).toHaveCount(0);
  // Discard and restore without changing allocations.
  await page.getByPlaceholder("Buscar movimiento").fill("Pendiente ejemplo 01");
  await page
    .getByRole("button", { name: "Revisar movimiento 23", exact: true })
    .click();
  await page
    .getByRole("button", { name: "No considerar", exact: true })
    .click();
  await expect(page.locator("#drawer")).toHaveCount(0);
  await page.getByRole("tab", { name: "Descartados", exact: true }).click();
  await page
    .getByRole("button", { name: "Revisar movimiento 23", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Volver a revisión", exact: true })
    .click();
  await expect(page.locator("#drawer")).toHaveCount(0);
  await page.getByRole("tab", { name: "Pendientes", exact: true }).click();
  await page.getByPlaceholder("Buscar movimiento").fill("");
  await expect(page.locator(".pagination")).toContainText("39 movimientos");
  // Category CRUD and category -> filtered history navigation.
  await page.getByRole("button", { name: "Categorías", exact: true }).click();
  await page
    .getByRole("button", { name: "Agregar categoría", exact: true })
    .click();
  await page.getByLabel("Nombre", { exact: true }).fill("Temporal ficticia");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator("#categoryDialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Renombrar Temporal ficticia", exact: true })
    .click();
  await page.getByLabel("Nombre", { exact: true }).fill("Temporal renombrada");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator("#categoryDialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Eliminar Temporal renombrada", exact: true })
    .click();
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.locator("#categoryDialog")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Ver movimientos de Categoria prueba",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(
    "Categoria prueba",
  );
  await page.getByLabel("Año", { exact: true }).selectOption("2026");
  await page.getByLabel("Mes", { exact: true }).selectOption("09");
  await expect(page.locator(".pagination")).toContainText("1 movimientos");
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Descargar filtrados en Excel", exact: true })
    .click();
  const download = await downloaded;
  await download.saveAs(path.join(folder, "filtered.xlsx"));
  const verify = spawnSync(
    python,
    [
      "-c",
      "from openpyxl import load_workbook; import sys; w=load_workbook(sys.argv[1]); assert w.active.max_row==2; w.close()",
      path.join(folder, "filtered.xlsx"),
    ],
    { encoding: "utf8" },
  );
  if (verify.status) throw Error(verify.stderr);
  // Statistics: missing month projections remain visible and canvases are nonblank.
  await page.getByRole("button", { name: "Estadísticas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tendencia mensual" }),
  ).toBeVisible();
  await page.getByLabel("Mes", { exact: true }).selectOption("09");
  await expect(page.locator("canvas")).toHaveCount(3);
  await page.screenshot({
    path: path.join(screenshots, "statistics-desktop.png"),
    fullPage: true,
  });
  if (
    !(await page
      .locator("canvas")
      .last()
      .evaluate((c) => {
        const a = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        return a.some((v, i) => i % 4 === 3 && v > 0);
      }))
  )
    throw Error("Blank chart");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(392);
  await page.screenshot({
    path: path.join(screenshots, "statistics-mobile.png"),
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    )
  )
    throw Error("Mobile page overflows");
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Bulk confirmation includes every page, retaining the explicit previous split.
  await page.getByRole("button", { name: /^Revisión/ }).click();
  await page.getByLabel("Año", { exact: true }).selectOption("");
  await page.getByLabel("Mes", { exact: true }).selectOption("");
  await page
    .getByRole("button", { name: "Confirmar todos", exact: true })
    .click();
  await expect(page.locator("#bulkDialog")).toContainText("39 movimientos");
  await page.getByRole("button", { name: "Confirmar 39", exact: true }).click();
  await expect(page.locator("#bulkDialog")).toHaveCount(0);
  // Import preview, confirmation and same-file replay.
  async function importFile() {
    await page
      .getByRole("button", { name: "Importar Excel", exact: true })
      .click();
    await page
      .getByLabel("Archivo Excel")
      .setInputFiles(path.join(folder, "import.xlsx"));
    await page.getByLabel("Mes de las cuotas").fill("2026-10");
    await page
      .getByRole("button", { name: "Revisar archivo", exact: true })
      .click();
  }
  await importFile();
  await expect(page.locator(".preview-row")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Confirmar importación", exact: true })
    .click();
  await expect(page.locator("#importDialog")).toHaveCount(0);
  await importFile();
  await expect(page.locator("#importDialog")).toContainText(
    "Archivo ya importado",
  );
  await page
    .getByRole("button", { name: "Abrir importación existente", exact: true })
    .click();
  await expect(page.locator("#importDialog")).toHaveCount(0);
  // Cut exact selection -> server validated snapshot -> protected review -> cancel.
  await page
    .getByRole("button", { name: "Cuentas del hogar", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Consultar", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Desde", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Hasta", { exact: true }).fill("2026-12-31");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Validar y guardar", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("checkbox", { name: "Incluir movimiento 13", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Validar y guardar", exact: true })
    .click();
  await expect(page.locator("#cutConfirm")).toContainText("48 movimientos");
  await page
    .getByLabel("Nota", { exact: true })
    .fill("Corte ficticio de prueba");
  await page
    .getByRole("button", { name: "Confirmar corte", exact: true })
    .click();
  await expect(page.locator("#cutConfirm")).toHaveCount(0);
  await page.getByRole("button", { name: "Ver corte 1", exact: true }).click();
  await expect(page.locator("#cutDetail")).toContainText(
    "Corte ficticio de prueba",
  );
  await page
    .locator("#cutDetail")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Anular último corte", exact: true })
    .click();
  await expect(page.locator(".cut-history-row")).toContainText("Anulado");
  await page.screenshot({
    path: path.join(screenshots, "cuts-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(392);
  await page.screenshot({
    path: path.join(screenshots, "cuts-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Revisión/ }).click();
  await expect(page.locator(".pagination")).toContainText("3 movimientos");
  await page.screenshot({
    path: path.join(screenshots, "ledger-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Revisar movimiento 62", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "No considerar", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "review-mobile.png"),
    fullPage: true,
  });
  await page
    .locator("#drawer")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const firstHome = new URL(page.url()).searchParams.get("household");
  await page
    .getByRole("button", { name: "Hogares y personas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agregar persona", exact: true })
    .click();
  await page.getByLabel("Nombre", { exact: true }).fill("Tercera");
  await page.getByLabel("Apellido", { exact: true }).fill("Prueba");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator(".household-panel table tbody tr")).toHaveCount(3);
  const firstPeople = (
    await (
      await page.request.get(`${url}/api/household?household=${firstHome}`)
    ).json()
  ).people;
  const targetId = firstPeople.find((p) => p.name === "Tercera").id;
  await page.screenshot({
    path: path.join(screenshots, "households-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(392);
  await page.screenshot({
    path: path.join(screenshots, "households-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /^Revisión/ }).click();
  await page
    .getByRole("button", { name: "Revisar movimiento 62", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Partes iguales", exact: true })
    .click();
  await expect(
    page.getByLabel("Tercera Prueba · CLP", { exact: true }),
  ).toHaveValue("666.666666");
  await page
    .locator("#drawer")
    .getByLabel("Categoría", { exact: true })
    .selectOption("Categoria prueba");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.locator("#drawer")).toHaveCount(0);
  await page.getByRole("button", { name: "Estadísticas", exact: true }).click();
  await page.getByLabel("Gasto", { exact: true }).selectOption(targetId);
  await expect(page.locator(".stats-metrics").first()).toContainText("666,67");
  // Independent browser account: knowing an ID never grants household access.
  const outsider = await browser.newContext();
  const other = await outsider.newPage();
  other.on("dialog", (d) => d.accept());
  await other.goto(url);
  await other
    .getByRole("button", { name: "Crear una cuenta", exact: true })
    .click();
  await other.getByLabel("Nombre de la cuenta", { exact: true }).fill("Bea");
  await other.getByLabel("Correo", { exact: true }).fill("bea@example.test");
  await other
    .getByLabel("Contraseña", { exact: true })
    .fill("Otra clave ficticia 456");
  await other
    .getByRole("button", { name: "Crear cuenta", exact: true })
    .click();
  await expect(
    other.getByRole("heading", { name: "Mis hogares", exact: true }),
  ).toBeVisible();
  for (const endpoint of [
    "config",
    "movements",
    "detail/1",
    "statistics",
    "cuts",
    "export",
    "export-filtered",
  ])
    expect(
      (
        await outsider.request.get(
          `${url}/api/${endpoint}?household=${firstHome}`,
        )
      ).status(),
    ).toBe(403);
  const otherSession = await (
    await outsider.request.get(url + "/api/session")
  ).json();
  expect(
    (
      await outsider.request.post(`${url}/api/review?household=${firstHome}`, {
        headers: { "X-Cuentas-Token": otherSession.token },
        data: { id: 1, action: "descartar" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await outsider.request.post(url + "/api/households", {
        data: { action: "claim", person_id: targetId },
      })
    ).status(),
  ).toBe(403);
  await other.getByLabel("ID de persona", { exact: true }).fill(targetId);
  await other
    .getByRole("button", { name: "Solicitar vinculación", exact: true })
    .click();
  await expect(
    other.getByText("Pendiente de aprobación", { exact: false }),
  ).toBeVisible();
  expect(
    (
      await outsider.request.get(`${url}/api/config?household=${firstHome}`)
    ).status(),
  ).toBe(403);
  await page
    .getByRole("button", { name: "Hogares y personas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Aprobar solicitud de Bea", exact: true })
    .click();
  await expect(
    page.getByText("Sin solicitudes pendientes", { exact: true }),
  ).toBeVisible();
  await other.reload();
  await expect(
    other.getByRole("heading", { name: "Revisión de gastos", exact: true }),
  ).toBeVisible();
  expect(
    (
      await outsider.request.get(`${url}/api/config?household=${firstHome}`)
    ).status(),
  ).toBe(200);
  expect(
    (
      await outsider.request.post(
        `${url}/api/households?household=${firstHome}`,
        {
          headers: { "X-Cuentas-Token": otherSession.token },
          data: { action: "add_person", name: "No autorizado" },
        },
      )
    ).status(),
  ).toBe(403);
  // A second home starts empty; both IDs may belong to the same account.
  await page.getByRole("button", { name: "Crear hogar", exact: true }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Segundo hogar");
  await page.getByLabel("Dirección", { exact: true }).fill("Calle ficticia 2");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Segundo hogar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hogares y personas", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Hogar activo")).toHaveValue(
    new URL(page.url()).searchParams.get("household"),
  );
  const secondHome = new URL(page.url()).searchParams.get("household");
  await page
    .getByRole("button", { name: "Hogares y personas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agregar persona", exact: true })
    .click();
  await page.getByLabel("Nombre", { exact: true }).fill("Bea duplicada");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator(".household-panel table tbody tr")).toHaveCount(2);
  const secondPeople = (
    await (
      await page.request.get(`${url}/api/household?household=${secondHome}`)
    ).json()
  ).people;
  const secondId = secondPeople.find((p) => p.name === "Bea duplicada").id;
  await other
    .getByRole("button", { name: "Hogares y personas", exact: true })
    .click();
  await other.getByLabel("ID de persona", { exact: true }).fill(secondId);
  await other
    .getByRole("button", { name: "Solicitar vinculación", exact: true })
    .click();
  await expect(
    other.getByText("Pendiente de aprobación", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Hogares y personas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Aprobar solicitud de Bea", exact: true })
    .click();
  await expect(
    page.getByText("Sin solicitudes pendientes", { exact: true }),
  ).toBeVisible();
  await other.reload();
  await expect(other.getByLabel("Hogar activo").locator("option")).toHaveCount(
    2,
  );
  // Archive only hides the current user's home; other members retain access.
  await page
    .getByRole("button", {
      name: `Archivar Segundo hogar (${secondHome})`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hogares y personas", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Hogar activo")).toHaveValue(firstHome);
  await expect(page.locator(".household-history")).toBeHidden();
  await page.getByRole("tab", { name: "Archivados", exact: true }).click();
  await expect(page.locator(".household-history .household-row")).toHaveCount(
    1,
  );
  await expect(page.locator(".household-history")).toContainText(
    "Segundo hogar",
  );
  await expect(page.locator(".household-list")).toBeHidden();
  await page.screenshot({
    path: path.join(screenshots, "households-archived-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(392);
  await page.screenshot({
    path: path.join(screenshots, "households-archived-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(
    (
      await page.request.get(`${url}/api/config?household=${secondHome}`)
    ).status(),
  ).toBe(403);
  expect(
    (
      await outsider.request.get(`${url}/api/config?household=${secondHome}`)
    ).status(),
  ).toBe(200);
  await page
    .getByRole("button", {
      name: `Reactivar Segundo hogar (${secondHome})`,
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Sin hogares archivados.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activos", exact: true }).click();
  await expect(page.locator(".household-list")).toContainText("Segundo hogar");
  await page
    .locator(".household-list")
    .getByRole("button", { name: "Segundo hogar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Segundo hogar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hogares y personas", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Crear hogar", exact: true }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Segundo hogar");
  await page.getByLabel("Dirección", { exact: true }).fill("Calle ficticia 2");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Ya tienes un hogar");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  await expect(page.getByLabel("Hogar activo").locator("option")).toHaveCount(
    2,
  );
  await page.getByLabel("Hogar activo").selectOption(firstHome);
  await expect(
    page.getByRole("heading", { name: "Revisión de gastos", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hogares y personas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retirar a Tercera", exact: true })
    .click();
  await expect(page.locator(".household-panel table")).toContainText(
    "Retirado",
  );
  expect(
    (
      await outsider.request.get(`${url}/api/config?household=${firstHome}`)
    ).status(),
  ).toBe(403);
  expect(
    (
      await outsider.request.get(`${url}/api/config?household=${secondHome}`)
    ).status(),
  ).toBe(200);
  await other.reload();
  await expect(other.getByLabel("Hogar activo")).toHaveValue(secondHome);
  await other
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(
    other.getByRole("heading", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
  expect(
    (
      await outsider.request.get(`${url}/api/config?household=${secondHome}`)
    ).status(),
  ).toBe(401);
  await outsider.close();
  await page
    .getByRole("button", {
      name: `Archivar Departamento (${firstHome})`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Hogar activo")).toHaveValue(secondHome);
  await page
    .getByRole("button", {
      name: `Archivar Segundo hogar (${secondHome})`,
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Sin hogares activos.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Archivados", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Reactivar Departamento (${firstHome})`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Hogar activo")).toHaveValue(firstHome);
  await expect(
    page.getByRole("heading", { name: "Hogares y personas", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: `Ir a Revisión de Departamento (${firstHome})`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revisión de gastos", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mi cuenta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mi cuenta", exact: true })).toBeVisible();
  await page.getByLabel("Nombre de la cuenta", { exact: true }).fill("Ana actualizada");
  await page.getByRole("button", { name: "Guardar nombre", exact: true }).click();
  await expect(page.locator(".account-link")).toContainText("Ana actualizada");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mi cuenta", exact: true })).toBeVisible();
  await page.screenshot({path:path.join(screenshots,"account-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("button", { name: "Mi cuenta", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:path.join(screenshots,"account-mobile.png"),fullPage:true});
  await page.getByLabel("Contraseña actual para eliminar", {exact:true}).fill("Una clave ficticia 123");
  await page.getByLabel("Escribe ELIMINAR").fill("ELIMINAR");
  await page.getByRole("button", {name:"Eliminar cuenta",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("otro administrador");
  await page.getByLabel("Contraseña actual", {exact:true}).fill("Una clave ficticia 123");
  await page.getByLabel("Nueva contraseña", {exact:true}).fill("Nueva clave ficticia 456");
  await page.getByLabel("Repetir nueva contraseña", {exact:true}).fill("Nueva clave ficticia 456");
  await page.getByRole("button", {name:"Cambiar contraseña",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Iniciar sesión",exact:true})).toBeVisible();
  await page.getByLabel("Correo",{exact:true}).fill("ana@example.test");
  await page.getByLabel("Contraseña",{exact:true}).fill("Nueva clave ficticia 456");
  await page.getByRole("button",{name:"Ingresar",exact:true}).click();
  await expect(page.getByRole("button", { name: "Mi cuenta", exact: true })).toContainText("Ana actualizada");
  const disposable = await browser.newContext();
  const guest = await disposable.newPage();
  guest.on("dialog", d => d.accept());
  await guest.goto(url);
  await guest.getByRole("button", {name:"Crear una cuenta",exact:true}).click();
  await guest.getByLabel("Nombre de la cuenta",{exact:true}).fill("Cuenta temporal");
  await guest.getByLabel("Correo",{exact:true}).fill("temporal@example.test");
  await guest.getByLabel("Contraseña",{exact:true}).fill("Clave temporal ficticia 123");
  await guest.getByRole("button", {name:"Crear cuenta",exact:true}).click();
  await guest.getByRole("button", {name:"Mi cuenta",exact:true}).click();
  await guest.getByLabel("Contraseña actual para eliminar",{exact:true}).fill("Clave temporal ficticia 123");
  await guest.getByLabel("Escribe ELIMINAR").fill("ELIMINAR");
  await guest.getByRole("button",{name:"Eliminar cuenta",exact:true}).click();
  await expect(guest.getByRole("heading",{name:"Iniciar sesión",exact:true})).toBeVisible();
  await expect(guest.getByRole("status")).toContainText("desactivada");
  await disposable.close();
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: finance regression, registration, three-person allocations, household isolation, approval, multiple IDs per account, revocation, logout, desktop/mobile.",
  );
  console.log("Synthetic fixtures:", folder);
})()
  .catch(async (e) => {
    console.error(e);
    if (page) {
      console.error((await page.locator("body").innerText()).slice(-2500));
      await page.screenshot({
        path: path.join(screenshots, "failure.png"),
        fullPage: true,
      });
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) {
      server.kill();
      await new Promise((r) => server.once("exit", r));
    }
  });
