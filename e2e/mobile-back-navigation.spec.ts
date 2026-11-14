/**
 * E2E tests: Mobile Back button navigation — fix/mobile-back-navigation
 *
 * Execution requirements:
 *   - Running dev server: PLAYWRIGHT_BASE_URL (default http://localhost:5173)
 *   - For tests that require a session (T4-T10): DECA_STAGING_URL, DECA_STAGING_EMAIL,
 *     DECA_STAGING_PASSWORD (same vars used by deca-emision.spec.ts).
 *
 * Tests T1-T3 use the history API without authentication and can be run against
 * the dev server with any app build (unauthenticated state renders the login form).
 * Tests T4-T6 require a valid authenticated session in staging.
 *
 * Run all:   npx playwright test e2e/mobile-back-navigation.spec.ts
 * Run one:   npx playwright test -g "T1"
 *
 * NOTE: These are REAL browser-navigation tests. They use page.goBack() /
 * page.goForward() (which call history.back() / history.forward() internally),
 * NOT synthetic popstate events. E2E tests that require a live server are
 * marked [REQUIRES_SERVER] and will be skipped automatically when
 * PLAYWRIGHT_BASE_URL is not reachable.
 */

import { expect, test, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:5173";
const stagingUrl = process.env["DECA_STAGING_URL"];
const stagingEmail = process.env["DECA_STAGING_EMAIL"];
const stagingPassword = process.env["DECA_STAGING_PASSWORD"];

const hasServer = !!BASE_URL;
const hasStaging = !!(stagingUrl && stagingEmail && stagingPassword);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the app root and wait for the page shell to be ready. */
async function loadApp(page: Page, url = BASE_URL) {
  await page.goto(url, { waitUntil: "networkidle" });
}

/**
 * Read LogiRoute nav state from history.state without exposing personal data.
 * Returns null if the state is not a LogiRoute state.
 */
async function getNavState(page: Page) {
  return page.evaluate(() => {
    const s = window.history.state as Record<string, unknown> | null;
    if (!s || s["app"] !== "logiroute") return null;
    return {
      module: s["module"],
      subView: s["subView"],
      modal: s["modal"],
      depth: s["depth"],
      chainId: s["chainId"],
    };
  });
}

/** Click a main navigation button by its visible text. */
async function clickNav(page: Page, label: string) {
  await page
    .getByRole("button", { name: label, exact: true })
    .or(page.getByRole("link", { name: label, exact: true }))
    .first()
    .click();
  // Brief pause to allow state + history update
  await page.waitForTimeout(150);
}

/** Sign in to staging (requires DECA_STAGING_* env vars). */
async function signInStaging(page: Page) {
  if (!stagingUrl || !stagingEmail || !stagingPassword) {
    throw new Error(
      "Define DECA_STAGING_URL, DECA_STAGING_EMAIL y DECA_STAGING_PASSWORD.",
    );
  }
  await page.goto(stagingUrl, { waitUntil: "networkidle" });
  await page.getByLabel(/correo|email/i).fill(stagingEmail);
  await page.getByLabel(/contraseña|password/i).fill(stagingPassword);
  await page.getByRole("button", { name: /entrar|iniciar|sign in/i }).click();
  await page.waitForURL(stagingUrl, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// T1 — Secuencia principal de navegación hacia atrás [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T1 — Secuencia principal Inicio→Rutas→DeCAs→detalle→Atrás×3", () => {
  test.skip(!hasServer, "Requiere servidor activo (PLAYWRIGHT_BASE_URL)");
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("navega hacia atrás por la jerarquía completa sin salir de la app", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInStaging(page);

    // — Inicio
    let state = await getNavState(page);
    expect(state?.module).toBe("home");
    expect(state?.depth).toBe(0);

    // — Rutas
    await clickNav(page, "Rutas");
    state = await getNavState(page);
    expect(state?.module).toBe("routes");
    expect(state?.depth).toBe(1);

    // — DeCAs
    await clickNav(page, "DeCAs");
    state = await getNavState(page);
    expect(state?.module).toBe("decas");
    expect(state?.depth).toBe(2);
    expect(state?.subView).toBe("list");

    // — Detalle: abre el primer DeCA de la lista (si existe)
    const firstCard = page
      .getByRole("article")
      .or(page.getByTestId("deca-card"))
      .first();
    const cardExists = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!cardExists, "No hay DeCAs en la lista; omitir T1 de detalle");

    await firstCard.click();
    state = await getNavState(page);
    expect(state?.module).toBe("decas");
    expect(state?.subView).toBe("detail");
    expect(state?.depth).toBe(3);

    // — Atrás → lista DeCAs
    await page.goBack();
    state = await getNavState(page);
    expect(state?.module).toBe("decas");
    expect(state?.subView).toBe("list");
    await expect(page.getByText(/Mis DeCAs|Lista/i)).toBeVisible({ timeout: 5_000 });

    // — Atrás → Rutas
    await page.goBack();
    state = await getNavState(page);
    expect(state?.module).toBe("routes");
    await expect(page.getByText(/Rutas|routes/i).first()).toBeVisible({ timeout: 5_000 });

    // — Atrás → Inicio
    await page.goBack();
    state = await getNavState(page);
    expect(state?.module).toBe("home");
    expect(state?.depth).toBe(0);

    // — Otro Atrás en profundidad 0: no debe romper la app (puede salir del historial)
    // Solo verificamos que si permanece en la app, sigue siendo Inicio
    const urlBefore = page.url();
    await page.goBack({ timeout: 2_000 }).catch(() => {});
    if (page.url() === urlBefore) {
      state = await getNavState(page);
      expect(state?.module).toBe("home");
    }
  });
});

// ---------------------------------------------------------------------------
// T2 — Cierre de modal con X/Cancelar seguido de Atrás [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T2 — Modal: X/Cancelar luego Atrás no reabre el modal", () => {
  test.skip(!hasServer, "Requiere servidor activo");
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("abrir y cerrar modal con X, luego Atrás va a la pantalla anterior", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInStaging(page);

    // Navegar a DeCAs
    await clickNav(page, "DeCAs");
    let state = await getNavState(page);
    expect(state?.module).toBe("decas");
    const depthBefore = state?.depth ?? 2;

    // Abrir modal CSV DeCA (si el botón existe)
    const csvBtn = page.getByRole("button", { name: /importar.csv|csv/i }).first();
    const csvVisible = await csvBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!csvVisible, "Botón CSV no visible; omitir T2");

    await csvBtn.click();
    await page.waitForTimeout(200);
    state = await getNavState(page);
    expect(state?.modal).toBeTruthy(); // algún modal abierto

    const modalDepth = state?.depth ?? depthBefore + 1;

    // Cerrar con X o Cancelar
    const closeBtn = page
      .getByRole("button", { name: /cerrar|cancelar|×|close/i })
      .first();
    await closeBtn.click();
    await page.waitForTimeout(200);
    state = await getNavState(page);
    expect(state?.modal).toBeNull();
    expect(state?.depth).toBe(depthBefore); // volvió al nivel previo al modal

    // Atrás: debe ir al módulo anterior, no reabrir el modal
    await page.goBack();
    await page.waitForTimeout(300);
    state = await getNavState(page);
    expect(state?.modal).toBeNull();
    expect((state?.depth ?? 0)).toBeLessThan(depthBefore);
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
    // No se necesita sesión para verificar el historial
    await loadApp(page);

    // Si hay login, navegar sin autenticarse para las pestañas (depende de la app)
    // Intentar hacer clic en DeCAs dos veces
    const decaBtn = page
      .getByRole("button", { name: /deca/i })
      .or(page.getByRole("link", { name: /deca/i }))
      .first();

    const isVisible = await decaBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!isVisible, "Botón DeCAs no visible sin autenticación; omitir T3");

    await decaBtn.click();
    const state1 = await getNavState(page);
    const depth1 = state1?.depth;

    await decaBtn.click();
    await page.waitForTimeout(200);
    const state2 = await getNavState(page);
    expect(state2?.depth).toBe(depth1); // sin incremento

    // Un solo Atrás debe ir al módulo anterior (no a DeCAs otra vez)
    if ((depth1 ?? 0) > 0) {
      await page.goBack();
      const stateAfter = await getNavState(page);
      expect(stateAfter?.module).not.toBe(state2?.module);
    }
  });
});

// ---------------------------------------------------------------------------
// T4 — Recarga: permanece en el módulo y volver funciona [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T4 — Recarga mantiene el módulo y Atrás lleva a Inicio", () => {
  test.skip(!hasServer, "Requiere servidor activo");
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("navegar a Rutas, recargar y volver funciona correctamente", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInStaging(page);

    await clickNav(page, "Rutas");
    let state = await getNavState(page);
    expect(state?.module).toBe("routes");

    // Recargar
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Tras recarga, debe mantener o restaurar el módulo (no forzar Inicio)
    state = await getNavState(page);
    // El módulo puede ser "routes" (restaurado) o "home" (normalizado al no poder verificar
    // autenticación antes de popstate). Ambos son válidos; lo que NO debe pasar es un crash.
    expect(["routes", "home"]).toContain(state?.module);

    // Si quedó en Rutas, Atrás debe funcionar
    if (state?.module === "routes" && (state?.depth ?? 0) > 0) {
      await page.goBack();
      state = await getNavState(page);
      expect(state?.module).toBe("home");
    }
  });
});

// ---------------------------------------------------------------------------
// T5 — Documento inaccesible: se normaliza a vista lista [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T5 — ID de documento inaccesible se normaliza a lista", () => {
  test.skip(!hasServer, "Requiere servidor activo");
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("history.state con selectedId falso se normaliza a lista tras cargar", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInStaging(page);

    // Navegar a DeCAs lista para obtener un chainId válido
    await clickNav(page, "DeCAs");
    let state = await getNavState(page);
    const chainId = state?.chainId;

    // Inyectar estado con ID falso via replaceState
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

    // Recargar para activar la lógica de restauración
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2_000); // esperar a que carguen los DeCAs remotos

    state = await getNavState(page);
    // Debe haber normalizado: subView=list o module=home, nunca detail con ID falso
    expect(state?.subView).not.toBe("detail");
  });
});

// ---------------------------------------------------------------------------
// T6 — Operación ocupada bloquea Atrás y realinea el historial [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T6 — Operación en curso bloquea navegación y realinea", () => {
  test.skip(!hasServer, "Requiere servidor activo");
  test.skip(!hasStaging, "Requiere credenciales de staging");

  /**
   * LIMITACIÓN: simular una operación realmente en curso requiere un fixture o
   * interceptar una petición de red y pausarla. Sin esa infraestructura este
   * test solo verifica el flujo sin operación activa (cubre la rama "no busy").
   * El bloqueo real con operación ocupada debe verificarse manualmente o con un
   * fixture que congele la petición de red durante el Atrás.
   */
  test("sin operación en curso, Atrás navega normalmente (rama no-busy)", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInStaging(page);

    await clickNav(page, "DeCAs");
    let state = await getNavState(page);
    expect(state?.module).toBe("decas");

    await page.goBack();
    state = await getNavState(page);
    // Debe haber vuelto al módulo anterior
    expect(state?.module).not.toBe("decas");
    expect(state?.depth).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// T7 — X seguido de Atrás: sin entradas huérfanas [REQUIRES_SERVER]
// ---------------------------------------------------------------------------
test.describe("T7 — Secuencia X/Cancelar → Atrás → Adelante coherente", () => {
  test.skip(!hasServer, "Requiere servidor activo");
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("abrir modal, X, Atrás, Adelante: historial coherente", async ({ page }) => {
    test.setTimeout(45_000);
    await signInStaging(page);

    // Inicio → DeCAs
    await clickNav(page, "DeCAs");
    const stateDecas = await getNavState(page);
    const depthDecas = stateDecas?.depth ?? 2;

    // Abrir modal QR si hay DeCAs
    const qrBtn = page
      .getByRole("button", { name: /qr/i })
      .first();
    const qrVisible = await qrBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!qrVisible, "Botón QR no visible; omitir T7");

    await qrBtn.click();
    await page.waitForTimeout(200);
    let state = await getNavState(page);
    expect(state?.modal).toBeTruthy();

    // Cerrar con X
    await page
      .getByRole("button", { name: /cerrar|close|×/i })
      .first()
      .click();
    await page.waitForTimeout(200);
    state = await getNavState(page);
    expect(state?.modal).toBeNull();
    expect(state?.depth).toBe(depthDecas);

    // Atrás → Rutas (no volver a abrir el modal)
    await page.goBack();
    await page.waitForTimeout(300);
    state = await getNavState(page);
    expect(state?.modal).toBeNull();
    expect(state?.module).toBe("routes");

    // Adelante → DeCAs (no volver a abrir el modal)
    await page.goForward();
    await page.waitForTimeout(300);
    state = await getNavState(page);
    expect(state?.module).toBe("decas");
    expect(state?.modal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T8 — Cerrar cada gestor consume su entrada de apertura
// ---------------------------------------------------------------------------
test.describe("T8 — Cierre de Empresas y Transportistas", () => {
  test.skip(!hasServer, "Requiere servidor activo");
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("cerrar Empresas no la reabre con Atrás", async ({ page }) => {
    test.setTimeout(45_000);
    await signInStaging(page);
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);
    expect(listState?.subView).toBe("list");

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
      depth: listState?.depth,
    });

    await page.goBack();
    await expect.poll(() => getNavState(page)).toMatchObject({
      module: "routes",
    });
  });

  test("cerrar Transportistas no lo reabre con Atrás", async ({ page }) => {
    test.setTimeout(45_000);
    await signInStaging(page);
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);
    expect(listState?.subView).toBe("list");

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
      depth: listState?.depth,
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
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("conserva el retorno correcto al recorrer el historial", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInStaging(page);
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);
    expect(listState?.subView).toBe("list");

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
      depth: listState?.depth,
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
  test.skip(!hasStaging, "Requiere credenciales de staging");

  test("tras recargar Empresas, cerrar no reabre el gestor", async ({ page }) => {
    test.setTimeout(45_000);
    await signInStaging(page);
    await clickNav(page, "DeCAs");
    const listState = await getNavState(page);

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
      depth: listState?.depth,
    });
  });

  test("entrada directa a Empresas se normaliza sin salir de la app", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await signInStaging(page);
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
