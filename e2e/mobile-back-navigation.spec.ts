/**
 * E2E tests: Mobile Back button navigation — fix/mobile-back-navigation
 *
 * Execution requirements:
 *   - Running dev server: PLAYWRIGHT_BASE_URL (exact local ports: localhost:5173 or 127.0.0.1:5173)
 *   - Network requests to external/remote services are strictly intercepted and blocked.
 *   - Auth and REST endpoints are simulated with deterministic local mocks.
 *
 * Run all:   npx playwright test e2e/mobile-back-navigation.spec.ts
 * Run one:   npx playwright test -g "T1"
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { DecaRow } from "../decaSupabaseService";
import type {
  AppModal,
  AppModule,
  DeCASubView,
  LogiRouteNavState,
} from "../navigationHistory";

// ---------------------------------------------------------------------------
// Config & Validations
// ---------------------------------------------------------------------------

const ALLOWED_LOCAL_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const MOCK_SUPABASE_ORIGIN = "http://127.0.0.1:54329";
const TAILWIND_URL = "https://cdn.tailwindcss.com/";
const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const tailwindScript = readFileSync(new URL("./fixtures/tailwind-3.4.17.js", import.meta.url));
const leafletCss = readFileSync(new URL("../node_modules/leaflet/dist/leaflet.css", import.meta.url));
if (
  createHash("sha256").update(tailwindScript).digest("hex") !==
  "176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15"
) {
  throw new Error("La fixture Tailwind E2E no coincide con su SHA-256.");
}
if (
  createHash("sha256").update(leafletCss).digest("base64") !==
  "p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
) {
  throw new Error("El CSS local de Leaflet no coincide con el SRI esperado.");
}
const CDN_RESPONSES = new Map([
  ["https://va.vercel-scripts.com/v1/script.debug.js", "application/javascript"],
  [
    "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap",
    "text/css",
  ],
]);
const TILE_ORIGINS = new Set([
  "https://a.tile.openstreetmap.org",
  "https://b.tile.openstreetmap.org",
  "https://c.tile.openstreetmap.org",
]);
const EMPTY_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const MOCK_SUPABASE_METHODS = new Map([
  ["/auth/v1/token", "POST"],
  ["/auth/v1/user", "GET"],
  ["/rest/v1/decas", "GET"],
  ["/rest/v1/rutas_activas", "GET"],
  ["/rest/v1/billing_daily_records", "GET"],
  ["/rest/v1/registro_jornadas", "GET"],
  ["/rest/v1/empresas_habituales", "GET"],
  ["/rest/v1/transportistas_habituales", "GET"],
]);

const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:5173";

function validateBaseUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`BASE_URL inválida: "${urlStr}"`);
  }
  if (!ALLOWED_LOCAL_ORIGINS.has(parsed.origin)) {
    throw new Error(
      `BASE_URL no permitida: "${urlStr}". Solo se permiten los orígenes locales exactos: ${[...ALLOWED_LOCAL_ORIGINS].join(", ")}`,
    );
  }
  return parsed;
}

const parsedBase = validateBaseUrl(BASE_URL);
const hasServer = Boolean(BASE_URL);

let networkViolations: string[] = [];
let diagnostics: string[] = [];

function capturesDiagnostics(titlePath: string[]): boolean {
  return titlePath.some(
    (title) => title.startsWith("T3 ") || title === "Login simulado E2E",
  );
}

test.beforeEach(async ({ context, page }, testInfo) => {
  networkViolations = [];
  diagnostics = [];
  validateBaseUrl(BASE_URL);

  if (capturesDiagnostics(testInfo.titlePath)) {
    const redact = (value: string) =>
      value
        .replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
          try {
            const parsed = new URL(url);
            return `${parsed.origin}${parsed.pathname}`;
          } catch {
            return "[URL redactada]";
          }
        })
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[correo redactado]")
        .replace(/\bBearer\s+\S+/gi, "Bearer [redactado]")
        .replace(/\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+\b/g, "[token redactado]")
        .replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)["']?[^\s,"'}]+/gi, "$1[redactado]");

    page.on("pageerror", (error) => {
      const entry = `pageerror: ${redact(error.stack ?? error.message)}`;
      diagnostics.push(entry);
      console.error(entry);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        const expectedIntegrityError =
          text.includes(LEAFLET_CSS_URL) && /integrity|digest/i.test(text);
        const entry = `console.error${expectedIntegrityError ? " [integridad Leaflet esperada]" : ""}: ${redact(text)}`;
        diagnostics.push(entry);
        console.error(entry);
      }
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (ALLOWED_LOCAL_ORIGINS.has(url.origin)) {
        diagnostics.push(
          `requestfailed: ${request.method()} ${redact(`${url.origin}${url.pathname}`)} ${request.failure()?.errorText ?? "unknown"}`,
        );
      }
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (ALLOWED_LOCAL_ORIGINS.has(url.origin) && response.status() >= 400) {
        diagnostics.push(
          `HTTP ${response.status()}: ${response.request().method()} ${redact(`${url.origin}${url.pathname}`)}`,
        );
      }
    });
  }

  await context.route("**/*", async (route) => {
    const request = route.request();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      networkViolations.push(`URL malformada: ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }

    const pathname = url.pathname;
    const method = request.method();
    const origin = url.origin;
    if (method === "GET" && url.href === TAILWIND_URL) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: tailwindScript,
      });
      return;
    }
    if (method === "GET" && url.href === LEAFLET_CSS_URL) {
      await route.fulfill({
        status: 200,
        contentType: "text/css",
        headers: { "access-control-allow-origin": "*" },
        body: leafletCss,
      });
      return;
    }
    const cdnContentType = CDN_RESPONSES.get(url.href);
    if (method === "GET" && cdnContentType) {
      await route.fulfill({
        status: 200,
        contentType: cdnContentType,
        headers: { "access-control-allow-origin": "*" },
        body: "",
      });
      return;
    }

    if (
      method === "GET" &&
      TILE_ORIGINS.has(origin) &&
      /^\/\d+\/\d+\/\d+\.png$/.test(pathname) &&
      url.href === `${origin}${pathname}`
    ) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: EMPTY_TILE,
      });
      return;
    }

    const isMockOrigin = origin === MOCK_SUPABASE_ORIGIN;
    const mockMethod = MOCK_SUPABASE_METHODS.get(pathname);
    if (
      isMockOrigin &&
      method === "OPTIONS" &&
      mockMethod &&
      request.headers()["access-control-request-method"] === mockMethod
    ) {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": mockMethod,
          "access-control-allow-headers":
            request.headers()["access-control-request-headers"] ?? "",
        },
      });
      return;
    }

    // 1. Endpoints de API comprobados PRIMERO (no pueden eludirse por ser origen local)
    if (isMockOrigin && pathname === "/auth/v1/token" && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          access_token: "mock-access-token",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "mock-refresh-token",
          user: {
            id: "00000000-0000-0000-0000-000000000001",
            aud: "authenticated",
            role: "authenticated",
            email: "mock-user@example.com",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        }),
      });
      return;
    }

    if (isMockOrigin && pathname === "/auth/v1/user" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          id: "00000000-0000-0000-0000-000000000001",
          aud: "authenticated",
          role: "authenticated",
          email: "mock-user@example.com",
          created_at: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }

    if (isMockOrigin && pathname === "/rest/v1/decas" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "content-range": "0-0/1" },
        body: JSON.stringify([
          {
            id: "11111111-1111-1111-1111-111111111111",
            user_id: "00000000-0000-0000-0000-000000000001",
            deleted_at: null,
            estado: "BORRADOR",
            fecha: "2026-11-20",
            destinatario: "Destinatario Mock",
            cargador: "Cargador Mock",
            origen: "Madrid",
            destino: "Barcelona",
            created_at: "2026-11-20T10:00:00.000Z",
            updated_at: "2026-11-20T10:00:00.000Z",
          },
        ]),
      });
      return;
    }

    if (isMockOrigin && pathname === "/rest/v1/rutas_activas" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([
          {
            user_id: "00000000-0000-0000-0000-000000000001",
            deliveries: [],
            sequence: [],
            revision: 1,
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ]),
      });
      return;
    }

    if (
      isMockOrigin &&
      (pathname === "/rest/v1/registro_jornadas" ||
        pathname === "/rest/v1/billing_daily_records" ||
        pathname === "/rest/v1/empresas_habituales" ||
        pathname === "/rest/v1/transportistas_habituales") &&
      method === "GET"
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "content-range": "0-0/0" },
        body: JSON.stringify([]),
      });
      return;
    }

    // 2. Recursos y assets locales: permitidos solo si el origen es local exacto y NO es ruta API
    const isApiPath =
      pathname.startsWith("/auth/v1/") ||
      pathname.startsWith("/rest/v1/") ||
      pathname.startsWith("/storage/v1/") ||
      pathname.startsWith("/functions/v1/") ||
      pathname === "/api" ||
      pathname.startsWith("/api/");

    if (ALLOWED_LOCAL_ORIGINS.has(origin) && !isApiPath) {
      await route.continue();
      return;
    }

    // 3. Cualquier otra solicitud no prevista: BLOQUEAR y registrar infracción
    networkViolations.push(
      `Solicitud de red no permitida interceptada y bloqueada: [${method}] ${request.url()}`,
    );
    await route.abort("blockedbyclient");
  });

  // WebSocket exacto
  const expectedPort =
    parsedBase.port || (parsedBase.protocol === "https:" ? "443" : "80");
  const wsProtocol = parsedBase.protocol === "https:" ? "wss:" : "ws:";
  const allowedWsOrigins = new Set([
    `${wsProtocol}//localhost:${expectedPort}`,
    `${wsProtocol}//127.0.0.1:${expectedPort}`,
  ]);

  await context.routeWebSocket(/.*/, (ws) => {
    let wsUrl: URL;
    try {
      wsUrl = new URL(ws.url());
    } catch {
      networkViolations.push(`WebSocket con URL malformada: ${ws.url()}`);
      ws.close({ code: 1008, reason: "URL malformada" });
      return;
    }

    const wsOrigin = wsUrl.origin;
    if (allowedWsOrigins.has(wsOrigin)) {
      ws.connectToServer();
      return;
    }

    networkViolations.push(
      `Conexión WebSocket no permitida interceptada y bloqueada: ${ws.url()}`,
    );
    ws.close({ code: 1008, reason: "Destino WebSocket no permitido" });
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (
    capturesDiagnostics(testInfo.titlePath) &&
    (testInfo.status !== testInfo.expectedStatus || networkViolations.length > 0)
  ) {
    await testInfo.attach("diagnostico", {
      body: diagnostics.length ? diagnostics.join("\n") : "Sin errores de JavaScript o HTTP local capturados.",
      contentType: "text/plain",
    });
    if (!page.isClosed()) {
      const dom = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("head, script, style, noscript").forEach((el) => el.remove());
        const safeText = /^(Email|Correo|Contraseña|Password|Entrar|Iniciar sesión|LogiRute|LogiRoute)$/i;
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const text = node.textContent?.trim() ?? "";
          if (text && !safeText.test(text)) node.textContent = "[redactado]";
        }
        clone.querySelectorAll("*").forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            if (
              !(attr.name === "id" && attr.value === "root") &&
              !(attr.name === "type" && /^(email|password|text|submit|button)$/.test(attr.value))
            ) {
              el.removeAttribute(attr.name);
            }
          }
        });
        return "<!DOCTYPE html>\n" + clone.outerHTML;
      });
      await testInfo.attach("dom-redactado", {
        body: dom,
        contentType: "text/html",
      });
      const screenshot = await page.screenshot({
        mask: [page.locator("input, textarea, select, img, svg, canvas, video, iframe")],
        style: "* { color: transparent !important; text-shadow: none !important; background-image: none !important; } *::before, *::after { content: none !important; }",
      });
      await testInfo.attach("captura-redactada", {
        body: screenshot,
        contentType: "image/png",
      });
    }
  }
  expect(
    networkViolations,
    `Se detectaron solicitudes de red no permitidas:\n${networkViolations.join("\n")}`,
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// Helpers y validación estricta de estado
// ---------------------------------------------------------------------------

function isAppModule(val: unknown): val is AppModule {
  return (
    val === "home" || val === "routes" || val === "decas" || val === "billing"
  );
}

function isDeCASubView(val: unknown): val is DeCASubView {
  return (
    val === "list" ||
    val === "form" ||
    val === "detail" ||
    val === "companies" ||
    val === "carriers"
  );
}

function isAppModal(val: unknown): val is AppModal {
  return (
    val === "registro" ||
    val === "csvRoute" ||
    val === "addDelivery" ||
    val === "decaQr" ||
    val === "decaCsv" ||
    val === "decaBulk" ||
    val === "plates"
  );
}

/**
 * Lee y valida exhaustivamente el estado de navegación en history.state.
 * Construye un LogiRouteNavState tipado y validado sin castings forzados.
 */
async function getNavState(page: Page): Promise<LogiRouteNavState | null> {
  const raw = await page.evaluate(() => window.history.state);
  if (!raw || typeof raw !== "object") return null;

  const s = raw as Record<string, unknown>;
  if (s["app"] !== "logiroute" || s["version"] !== 1) {
    return null;
  }
  if (typeof s["chainId"] !== "string" || typeof s["depth"] !== "number") {
    return null;
  }
  if (!isAppModule(s["module"])) {
    return null;
  }

  const subView = isDeCASubView(s["subView"]) ? s["subView"] : undefined;
  const modal = isAppModal(s["modal"]) ? s["modal"] : undefined;
  const selectedId =
    typeof s["selectedId"] === "string" ? s["selectedId"] : undefined;
  const userId = typeof s["userId"] === "string" ? s["userId"] : null;

  const state: LogiRouteNavState = {
    app: "logiroute",
    version: 1,
    chainId: s["chainId"],
    depth: s["depth"],
    module: s["module"],
    subView,
    modal,
    selectedId,
    userId,
  };
  return state;
}

/** Click a main navigation button by its visible text. */
async function clickNav(page: Page, label: string) {
  await page
    .getByRole("button", { name: label, exact: true })
    .or(page.getByRole("link", { name: label, exact: true }))
    .first()
    .click();
  await page.waitForTimeout(150);
}

/** Iniciar sesión simulada confirmando obligatoriamente que la app pasa a estar autenticada. */
async function signInSimulated(page: Page) {
  validateBaseUrl(BASE_URL);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const mainNav = page.getByRole("navigation", {
    name: "Secciones principales",
  });
  if (await mainNav.isVisible({ timeout: 1_000 }).catch(() => false)) {
    return;
  }

  const emailField = page.getByLabel(/correo|email/i);
  const passField = page.getByLabel(/contraseña|password/i);
  const submitBtn = page.getByRole("button", {
    name: /entrar|iniciar|sign in/i,
  });

  await expect(
    emailField,
    "El formulario de autenticación no está visible y la aplicación no está autenticada",
  ).toBeVisible({ timeout: 10_000 });
  await emailField.fill("mock-user@example.com");
  await passField.fill("MockPassword123!");
  await submitBtn.click();

  await expect(
    mainNav,
    "La autenticación simulada falló: la barra de secciones principales no se mostró",
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Login simulado E2E", () => {
  test("muestra el formulario y la navegación tras autenticarse", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    const emailField = page.getByLabel(/correo|email/i);
    const passField = page.getByLabel(/contraseña|password/i);
    await expect(emailField).toBeVisible({ timeout: 10_000 });
    await expect(passField).toBeVisible();

    await emailField.fill("mock-user@example.com");
    await passField.fill("MockPassword123!");
    await page.getByRole("button", { name: /entrar|iniciar|sign in/i }).click();

    await expect(
      page.getByRole("navigation", { name: "Secciones principales" }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// T1 — Secuencia principal de navegación hacia atrás [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T1 — Secuencia principal Inicio→Rutas→DeCAs→detalle→Atrás×3", () => {
  test.skip(!hasServer, "Requiere servidor activo (PLAYWRIGHT_BASE_URL)");

  test("navega hacia atrás por la jerarquía completa sin salir de la app", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInSimulated(page);

    // — Inicio
    const stateHome = await getNavState(page);
    if (!stateHome || typeof stateHome.depth !== "number") {
      throw new Error(`T1: Estado inicial inválido: ${JSON.stringify(stateHome)}`);
    }
    expect(stateHome.module).toBe("home");
    expect(stateHome.depth).toBe(0);

    // — Rutas
    await clickNav(page, "Rutas");
    const stateRutas = await getNavState(page);
    if (!stateRutas || typeof stateRutas.depth !== "number") {
      throw new Error(`T1: Estado Rutas inválido: ${JSON.stringify(stateRutas)}`);
    }
    expect(stateRutas.module).toBe("routes");
    expect(stateRutas.depth).toBe(1);

    // — DeCAs
    await clickNav(page, "DeCAs");
    const stateDecas = await getNavState(page);
    if (!stateDecas || typeof stateDecas.depth !== "number") {
      throw new Error(`T1: Estado DeCAs inválido: ${JSON.stringify(stateDecas)}`);
    }
    expect(stateDecas.module).toBe("decas");
    expect(stateDecas.depth).toBe(2);
    expect(stateDecas.subView).toBe("list");

    // — Detalle: abre el primer DeCA de la lista
    const firstCard = page
      .getByRole("article")
      .or(page.getByTestId("deca-card"))
      .first();
    await expect(
      firstCard,
      "T1: No hay tarjetas DeCA visibles en la lista.",
    ).toBeVisible({ timeout: 5_000 });

    await firstCard
      .getByRole("button", { name: "Abrir DeCA de Destinatario Mock", exact: true })
      .click();
    const stateDetail = await getNavState(page);
    if (!stateDetail || typeof stateDetail.depth !== "number") {
      throw new Error(`T1: Estado detalle inválido: ${JSON.stringify(stateDetail)}`);
    }
    expect(stateDetail.module).toBe("decas");
    expect(stateDetail.subView).toBe("detail");
    expect(stateDetail.depth).toBe(3);

    // — Atrás → lista DeCAs
    await page.goBack();
    const stateBackList = await getNavState(page);
    if (!stateBackList || typeof stateBackList.depth !== "number") {
      throw new Error(
        `T1: Estado tras volver a lista inválido: ${JSON.stringify(stateBackList)}`,
      );
    }
    expect(stateBackList.module).toBe("decas");
    expect(stateBackList.subView).toBe("list");
    await expect(page.getByText(/Mis DeCAs|Lista/i)).toBeVisible({ timeout: 5_000 });

    // — Atrás → Rutas
    await page.goBack();
    const stateBackRutas = await getNavState(page);
    if (!stateBackRutas || typeof stateBackRutas.depth !== "number") {
      throw new Error(
        `T1: Estado tras volver a Rutas inválido: ${JSON.stringify(stateBackRutas)}`,
      );
    }
    expect(stateBackRutas.module).toBe("routes");
    await expect(page.getByText(/Rutas|routes/i).first()).toBeVisible({ timeout: 5_000 });

    // — Atrás → Inicio
    await page.goBack();
    const stateBackHome = await getNavState(page);
    if (!stateBackHome || typeof stateBackHome.depth !== "number") {
      throw new Error(
        `T1: Estado tras volver a Inicio inválido: ${JSON.stringify(stateBackHome)}`,
      );
    }
    expect(stateBackHome.module).toBe("home");
    expect(stateBackHome.depth).toBe(0);

    // — Otro Atrás en profundidad 0: sigue siendo Inicio si permanece en la app
    const urlBefore = page.url();
    await page.goBack({ timeout: 2_000 }).catch(() => {});
    if (page.url() === urlBefore) {
      const stateFinal = await getNavState(page);
      if (!stateFinal) {
        throw new Error("T1: Estado nulo tras popstate final en Inicio");
      }
      expect(stateFinal.module).toBe("home");
    }
  });
});

// ---------------------------------------------------------------------------
// T2 — Cierre de modal con X/Cancelar seguido de Atrás [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T2 — Modal: X/Cancelar luego Atrás no reabre el modal", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("abrir y cerrar modal con X, luego Atrás va a la pantalla anterior", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);

    // Navegar a DeCAs
    await clickNav(page, "DeCAs");
    const state = await getNavState(page);
    if (!state || typeof state.depth !== "number") {
      throw new Error(
        `T2: Estado inicial en DeCAs inválido o 'depth' ausente: ${JSON.stringify(state)}`,
      );
    }
    expect(state.module).toBe("decas");
    const depthBefore: number = state.depth;

    // Abrir modal CSV DeCA
    const csvBtn = page.getByRole("button", { name: /importar.csv|csv/i }).first();
    await expect(
      csvBtn,
      "T2: Botón de importación CSV no visible en la vista DeCAs.",
    ).toBeVisible({ timeout: 5_000 });

    await csvBtn.click();
    await page.waitForTimeout(200);
    const modalOpenState = await getNavState(page);
    if (
      !modalOpenState ||
      typeof modalOpenState.depth !== "number" ||
      !modalOpenState.modal
    ) {
      throw new Error(
        `T2: Se esperaba modal abierto con depth numérico: ${JSON.stringify(modalOpenState)}`,
      );
    }
    const modalDepth: number = modalOpenState.depth;
    expect(modalDepth).toBeGreaterThan(depthBefore);

    // Cerrar el panel CSV
    const csvPanel = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "Importar DeCAs desde CSV",
        exact: true,
      }),
    });
    const closeBtn = csvPanel.getByRole("button", {
      name: "Cancelar",
      exact: true,
    });
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });
    await closeBtn.click();
    await page.waitForTimeout(200);
    const modalClosedState = await getNavState(page);
    if (!modalClosedState || typeof modalClosedState.depth !== "number") {
      throw new Error(
        `T2: Estado tras cerrar modal inválido: ${JSON.stringify(modalClosedState)}`,
      );
    }
    expect(modalClosedState.modal).toBeUndefined();
    expect(modalClosedState.depth).toBe(depthBefore);

    // Atrás: debe ir al módulo anterior, no reabrir el modal
    await page.goBack();
    await page.waitForTimeout(300);
    const stateBack = await getNavState(page);
    if (!stateBack || typeof stateBack.depth !== "number") {
      throw new Error(
        `T2: Estado tras retroceso inválido: ${JSON.stringify(stateBack)}`,
      );
    }
    expect(stateBack.modal).toBeUndefined();
    expect(stateBack.depth).toBeLessThan(depthBefore);
  });
});

// ---------------------------------------------------------------------------
// T3 — Doble clic en la misma pestaña no añade entradas duplicadas
// ---------------------------------------------------------------------------
test.describe("T3 — Doble clic en pestaña: sin entradas duplicadas en historial", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("doble clic en DeCAs solo añade una entrada al historial", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await signInSimulated(page);

    const decaBtn = page
      .getByRole("button", { name: /deca/i })
      .or(page.getByRole("link", { name: /deca/i }))
      .first();

    await expect(
      decaBtn,
      "T3: Botón DeCAs no visible para comprobar clics repetidos.",
    ).toBeVisible({ timeout: 5_000 });

    await decaBtn.click();
    const state1 = await getNavState(page);
    if (!state1 || typeof state1.depth !== "number") {
      throw new Error(
        `T3: Estado inicial tras primer clic inválido: ${JSON.stringify(state1)}`,
      );
    }
    const depth1: number = state1.depth;

    await decaBtn.click();
    await page.waitForTimeout(200);
    const state2 = await getNavState(page);
    if (!state2 || typeof state2.depth !== "number") {
      throw new Error(
        `T3: Estado tras segundo clic inválido: ${JSON.stringify(state2)}`,
      );
    }
    expect(state2.depth).toBe(depth1);

    if (depth1 <= 0) {
      throw new Error(
        `T3 requiere un depth inicial mayor a 0 para verificar retroceso; valor recibido: ${depth1}`,
      );
    }
    await page.goBack();
    const stateAfter = await getNavState(page);
    if (!stateAfter) {
      throw new Error("T3: Estado nulo tras retroceder");
    }
    expect(stateAfter.module).not.toBe(state2.module);
  });
});

// ---------------------------------------------------------------------------
// T4 — Recarga: permanece en el módulo y volver funciona [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T4 — Recarga mantiene el módulo y Atrás lleva a Inicio", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("navegar a Rutas, recargar y volver funciona correctamente", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);

    await clickNav(page, "Rutas");
    const stateBeforeReload = await getNavState(page);
    if (!stateBeforeReload || typeof stateBeforeReload.depth !== "number") {
      throw new Error(
        `T4: Estado antes de recarga inválido: ${JSON.stringify(stateBeforeReload)}`,
      );
    }
    expect(stateBeforeReload.module).toBe("routes");

    // Recargar
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // El contrato de useAppNavigation exige conservar "routes" tras recargar si la sesión es válida
    const stateAfterReload = await getNavState(page);
    if (!stateAfterReload || typeof stateAfterReload.depth !== "number") {
      throw new Error(
        `T4: Estado posterior a recarga inválido: ${JSON.stringify(stateAfterReload)}`,
      );
    }
    expect(stateAfterReload.module).toBe("routes");
    expect(stateAfterReload.depth).toBeGreaterThan(0);

    // Retroceso obligatorio hacia Inicio
    await page.goBack();
    const stateAfterBack = await getNavState(page);
    if (!stateAfterBack || typeof stateAfterBack.depth !== "number") {
      throw new Error(
        `T4: Estado nulo o inválido tras retroceder a Inicio: ${JSON.stringify(stateAfterBack)}`,
      );
    }
    expect(stateAfterBack.module).toBe("home");
    expect(stateAfterBack.depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T5 — Documento inaccesible: se normaliza a vista lista [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T5 — ID de documento inaccesible se normaliza a lista", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("history.state con selectedId falso se normaliza a lista tras cargar", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);

    await clickNav(page, "DeCAs");
    const state = await getNavState(page);
    if (!state) {
      throw new Error("T5: No se pudo obtener el estado inicial en DeCAs.");
    }
    const chainId = state.chainId;

    await page.evaluate(
      ([cId]) => {
        window.history.replaceState(
          {
            app: "logiroute",
            version: 1,
            chainId: cId,
            depth: 3,
            module: "decas",
            subView: "detail",
            selectedId: "00000000-0000-0000-0000-000000000000",
            modal: null,
            userId: null,
          },
          "",
        );
      },
      [chainId],
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1_000);

    const stateAfterReload = await getNavState(page);
    if (!stateAfterReload) {
      throw new Error("T5: Estado nulo tras recargar con ID falso.");
    }
    expect(stateAfterReload.subView).not.toBe("detail");
  });
});

// ---------------------------------------------------------------------------
// T6 — Operación ocupada bloquea Atrás y realinea el historial [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T6 — Operación en curso bloquea navegación y realinea", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("sin operación en curso, Atrás navega normalmente (rama no-busy)", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);

    await clickNav(page, "DeCAs");
    const state = await getNavState(page);
    if (!state || typeof state.depth !== "number") {
      throw new Error(`T6: Estado en DeCAs inválido: ${JSON.stringify(state)}`);
    }
    expect(state.module).toBe("decas");

    await page.goBack();
    const stateAfterBack = await getNavState(page);
    if (!stateAfterBack || typeof stateAfterBack.depth !== "number") {
      throw new Error(
        `T6: Estado nulo o inválido tras retroceder: ${JSON.stringify(stateAfterBack)}`,
      );
    }
    expect(stateAfterBack.module).not.toBe("decas");
    expect(stateAfterBack.depth).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// T7 — X seguido de Atrás: sin entradas huérfanas [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T7 — Secuencia X/Cancelar → Atrás → Adelante coherente", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("abrir modal, X, Atrás, Adelante: historial coherente", async ({ page }) => {
    test.setTimeout(45_000);
    const emittedDeca: DecaRow = {
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "00000000-0000-0000-0000-000000000001",
      deleted_at: null,
      estado: "EMITIDO",
      fecha: "2026-11-20",
      empresa_habitual_id: null,
      cargador: "Cargador Mock",
      cargador_nif: null,
      destinatario: "Destinatario Mock",
      destinatario_nif: null,
      destinatario_codigo_postal: null,
      destinatario_pais: null,
      transportista: null,
      transportista_habitual_id: null,
      transportista_nif: null,
      transportista_direccion: null,
      transportista_ciudad: null,
      transportista_codigo_postal: null,
      transportista_provincia: null,
      transportista_pais: null,
      transportista_telefono: null,
      transportista_email: null,
      transportista_notas: null,
      mercancia: null,
      bultos: null,
      peso_bruto: null,
      matricula: null,
      origen: "Madrid",
      destino: "Barcelona",
      ciudad_destino: null,
      referencia_albaran: null,
      observaciones: null,
      created_at: "2026-11-20T10:00:00.000Z",
      updated_at: "2026-11-20T10:00:00.000Z",
      emitted_at: "2026-11-20T10:00:00.000Z",
      pdf_path: "e2e/deca.pdf",
      pdf_public_url: "https://example.invalid/e2e-deca.pdf",
      pdf_version: 1,
      pdf_sha256: "0".repeat(64),
      emission_request_id: "22222222-2222-2222-2222-222222222222",
      emission_started_at: "2026-11-20T10:00:00.000Z",
      emission_error: null,
    };
    await page.route(
      (url) => url.origin === MOCK_SUPABASE_ORIGIN && url.pathname === "/rest/v1/decas",
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*", "content-range": "0-0/1" },
          body: JSON.stringify([emittedDeca]),
        });
      },
    );
    await signInSimulated(page);

    // Preparar explícitamente el recorrido: Inicio → Rutas → DeCAs para que el módulo anterior sea 'routes'
    await clickNav(page, "Rutas");
    const stateRutas = await getNavState(page);
    if (!stateRutas || stateRutas.module !== "routes") {
      throw new Error(`T7: Estado en Rutas inválido: ${JSON.stringify(stateRutas)}`);
    }

    await clickNav(page, "DeCAs");
    const stateDecas = await getNavState(page);
    if (
      !stateDecas ||
      typeof stateDecas.depth !== "number" ||
      stateDecas.module !== "decas"
    ) {
      throw new Error(`T7: Estado en DeCAs inválido: ${JSON.stringify(stateDecas)}`);
    }
    const depthDecas = stateDecas.depth;

    // Abrir modal QR
    const card = page.getByRole("article").filter({
      has: page.getByRole("button", {
        name: "Abrir DeCA de Destinatario Mock",
        exact: true,
      }),
    });
    const qrBtn = card.getByRole("button", { name: "Ver QR", exact: true });
    await expect(qrBtn, "T7: Botón QR no visible en DeCAs.").toBeVisible({
      timeout: 5_000,
    });

    await qrBtn.click();
    await page.waitForTimeout(200);
    const stateModalOpen = await getNavState(page);
    if (!stateModalOpen || !stateModalOpen.modal) {
      throw new Error(
        `T7: Modal QR no se abrió: ${JSON.stringify(stateModalOpen)}`,
      );
    }

    const qrDialog = page.getByRole("dialog", {
      name: "QR del PDF oficial",
      exact: true,
    });
    await expect(qrDialog).toBeVisible();
    await qrDialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.waitForTimeout(200);
    const stateModalClosed = await getNavState(page);
    if (!stateModalClosed || typeof stateModalClosed.depth !== "number") {
      throw new Error(
        `T7: Estado tras cerrar modal inválido: ${JSON.stringify(stateModalClosed)}`,
      );
    }
    expect(stateModalClosed.modal).toBeUndefined();
    expect(stateModalClosed.depth).toBe(depthDecas);

    // Atrás → Rutas (módulo anterior preparado explícitamente)
    await page.goBack();
    await page.waitForTimeout(300);
    const stateBackToRutas = await getNavState(page);
    if (!stateBackToRutas) {
      throw new Error("T7: Estado nulo tras retroceder a Rutas");
    }
    expect(stateBackToRutas.modal).toBeUndefined();
    expect(stateBackToRutas.module).toBe("routes");

    // Adelante → DeCAs
    await page.goForward();
    await page.waitForTimeout(300);
    const stateForwardToDecas = await getNavState(page);
    if (!stateForwardToDecas) {
      throw new Error("T7: Estado nulo tras avanzar a DeCAs");
    }
    expect(stateForwardToDecas.module).toBe("decas");
    expect(stateForwardToDecas.modal).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T8 — Cerrar cada gestor consume su entrada de apertura
// ---------------------------------------------------------------------------
test.describe("T8 — Cierre de Empresas y Transportistas", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("cerrar Empresas no la reabre con Atrás", async ({ page }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);
    await clickNav(page, "Rutas");
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "routes",
    });
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);
    if (!listState || typeof listState.depth !== "number") {
      throw new Error(`T8: listState inválido: ${JSON.stringify(listState)}`);
    }
    expect(listState.subView).toBe("list");

    await page.getByRole("button", { name: "Empresas", exact: true }).click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
    });

    await page
      .getByRole("button", { name: "Volver a DeCAs", exact: true })
      .click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
      depth: listState.depth,
    });

    await page.goBack();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "routes",
    });
  });

  test("cerrar Transportistas no lo reabre con Atrás", async ({ page }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);
    await clickNav(page, "Rutas");
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "routes",
    });
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);
    if (!listState || typeof listState.depth !== "number") {
      throw new Error(`T8: listState inválido: ${JSON.stringify(listState)}`);
    }
    expect(listState.subView).toBe("list");

    await page
      .getByRole("button", { name: "Transportistas", exact: true })
      .click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "carriers",
    });

    await page
      .getByRole("button", { name: "Volver a DeCAs", exact: true })
      .click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
      depth: listState.depth,
    });

    await page.goBack();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "routes",
    });
  });
});

// ---------------------------------------------------------------------------
// T9 — Cierre anidado y registros válidos tras Atrás/Adelante
// ---------------------------------------------------------------------------
test.describe("T9 — Empresas → Transportistas → cerrar → Empresas → cerrar", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("conserva el retorno correcto al recorrer el historial", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInSimulated(page);
    await clickNav(page, "Rutas");
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "routes",
    });
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);
    if (!listState || typeof listState.depth !== "number") {
      throw new Error(`T9: listState inválido: ${JSON.stringify(listState)}`);
    }
    expect(listState.subView).toBe("list");

    await page.getByRole("button", { name: "Empresas", exact: true }).click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
    });

    await page
      .getByRole("button", { name: "Transportistas", exact: true })
      .click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "carriers",
    });

    const closeButton = page.getByRole("button", {
      name: "Volver a DeCAs",
      exact: true,
    });
    await closeButton.click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
    });

    await page.goForward();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "carriers",
    });
    await closeButton.click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
    });

    await closeButton.click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
      depth: listState.depth,
    });
    await page.goBack();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "routes",
    });

    await page.goForward();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
    });
    await page.goForward();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
    });
    await closeButton.click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
    });
  });
});

// ---------------------------------------------------------------------------
// T10 — Manager restaurado: cerrar sin consumir historial externo
// ---------------------------------------------------------------------------
test.describe("T10 — Fallback de cierre tras recarga o entrada directa", () => {
  test.skip(!hasServer, "Requiere servidor activo");

  test("tras recargar Empresas, cerrar no reabre el gestor", async ({ page }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);
    if (!listState || typeof listState.depth !== "number") {
      throw new Error(`T10: listState inválido: ${JSON.stringify(listState)}`);
    }

    await page.getByRole("button", { name: "Empresas", exact: true }).click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
    });
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
    });

    const urlBeforeClose = page.url();
    await page
      .getByRole("button", { name: "Volver a DeCAs", exact: true })
      .click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
    });
    expect(page.url()).toBe(urlBeforeClose);

    await page.goBack();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
      depth: listState.depth,
    });
  });

  test("entrada directa a Empresas se normaliza sin salir de la app", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInSimulated(page);
    await page.evaluate(() => {
      const current = window.history.state as Record<string, unknown>;
      window.history.replaceState(
        {
          ...current,
          module: "decas",
          subView: "companies",
          depth: 0,
          selectedId: undefined,
          modal: undefined,
        },
        "",
      );
    });
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "companies",
      depth: 0,
    });

    const urlBeforeClose = page.url();
    await page
      .getByRole("button", { name: "Volver a DeCAs", exact: true })
      .click();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "decas",
      subView: "list",
      depth: 0,
    });
    expect(page.url()).toBe(urlBeforeClose);
  });
});
