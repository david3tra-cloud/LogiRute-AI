import { createHash } from "node:crypto";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";

type EmittedDecaRow = {
  id: string;
  estado: string;
  pdf_public_url: string | null;
  pdf_sha256: string | null;
};

const stagingUrl = process.env.DECA_STAGING_URL;
const email = process.env.DECA_STAGING_EMAIL;
const password = process.env.DECA_STAGING_PASSWORD;

test.describe("Emisión oficial DeCA en staging", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    if (!stagingUrl || !email || !password) {
      throw new Error(
        "Define DECA_STAGING_URL, DECA_STAGING_EMAIL y DECA_STAGING_PASSWORD.",
      );
    }
    await signIn(page);
  });

  test("reserva un borrador y lo deja en EMITIENDO", async ({ page }) => {
    const deca = await createDraft(page);
    const reservation = await reserveDraft(page, deca.marker);

    expect(reservation.estado).toBe("EMITIENDO");
    expect(reservation.emission_request_id).toBeTruthy();
    expect(reservation.emission_started_at).toBeTruthy();
    await expect(page.getByRole("button", { name: "Finalizar emisión" })).toBeVisible();
  });

  test("reintenta la reserva y verifica estado, PDF y SHA-256", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const deca = await createDraft(page);
    const reservation = await reserveDraft(page, deca.marker);
    const emissionRequestId = String(reservation.emission_request_id);
    const expectedPath = `${reservation.user_id}/${reservation.id}/v1-${emissionRequestId}.pdf`;
    let failFirstFinalize = true;

    await page.route("**/rest/v1/decas**", async (route) => {
      const request = route.request();
      if (isFinalizeRequest(request) && failFirstFinalize) {
        failFirstFinalize = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Fallo temporal simulado por E2E" }),
        });
        return;
      }
      await route.continue();
    });

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Finalizar emisión" }).click();
    await expect(page.getByRole("button", { name: "Reintentar emisión" })).toBeVisible();
    await expect(page.getByText(/continúa en EMITIENDO/)).toBeVisible();

    const finalizeRequestPromise = page.waitForRequest(isFinalizeRequest, {
      timeout: 15_000,
    });
    const finalizeResponsePromise = page.waitForResponse(
      (response) => isFinalizeRequest(response.request()),
      { timeout: 15_000 },
    );
    const uploadResponsePromise = page.waitForResponse(
      (response) => isOfficialPdfUpload(response.request()),
      { timeout: 15_000 },
    );
    const remoteReadRequestPromise = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());
      return (
        request.method() === "GET" &&
        isDecasRestRequest(request) &&
        requestUrl.searchParams.get("id") === `eq.${reservation.id}`
      );
    }, { timeout: 60_000 });
    await page.getByRole("button", { name: "Reintentar emisión" }).click();
    const remoteReadRequest = await remoteReadRequestPromise;
    const evidencePromise = Promise.allSettled([
      finalizeRequestPromise,
      finalizeResponsePromise,
      uploadResponsePromise,
    ]);

    const requestHeaders = await remoteReadRequest.allHeaders();
    expect(requestHeaders.apikey).toBeTruthy();
    expect(requestHeaders.authorization).toBeTruthy();
    let emitted: EmittedDecaRow | undefined;
    let pollingError: unknown;
    let storageResponseBody: string | undefined;
    let storageFailureMessage: string | undefined;
    const storageFailurePromise = uploadResponsePromise.then(
      async (response) => {
        storageResponseBody = await response.text();
        const acceptable =
          response.status() === 200 ||
          response.status() === 201 ||
          isExistingStorageObjectResponse(response, storageResponseBody);
        if (acceptable && response.url().includes(expectedPath)) {
          return;
        }
        storageFailureMessage =
          `Storage respondió con un estado inesperado: HTTP ${response.status()} ${response.url()}. Cuerpo: ${storageResponseBody}`;
        throw new Error(storageFailureMessage);
      },
      () => undefined,
    );
    const pollingPromise = expect
      .poll(
        async () => {
          const current = await getRemoteDeca(
            context,
            remoteReadRequest.url(),
            {
              apikey: requestHeaders.apikey,
              authorization: requestHeaders.authorization,
              accept: "application/json",
            },
          );
          emitted = current?.estado === "EMITIDO" ? current : undefined;
          return emitted?.estado ?? null;
        },
        { timeout: 60_000, intervals: [500, 1000, 2000] },
      )
      .toBe("EMITIDO");
    try {
      await Promise.race([
        pollingPromise,
        storageFailurePromise.then(() => pollingPromise),
      ]);
    } catch (error) {
      if (storageFailureMessage) {
        throw new Error(storageFailureMessage);
      }
      pollingError = error;
    }
    const [
      finalizeRequestResult,
      finalizeResponseResult,
      uploadResponseResult,
    ] = await evidencePromise;
    if (!emitted) {
      const finalizeRequestDetails =
        finalizeRequestResult.status === "fulfilled"
          ? `${finalizeRequestResult.value.method()} ${finalizeRequestResult.value.url()}`
          : "no se observó petición de finalización en 15s";
      const finalizeResponseDetails =
        finalizeResponseResult.status === "fulfilled"
          ? `HTTP ${finalizeResponseResult.value.status()}, cuerpo: ${await finalizeResponseResult.value.text()}`
          : "no se observó respuesta de finalización en 15s";
      const storageResponseDetails =
        uploadResponseResult.status === "fulfilled"
          ? `HTTP ${uploadResponseResult.value.status()} ${uploadResponseResult.value.url()}, cuerpo: ${storageResponseBody ?? (await uploadResponseResult.value.text())}`
          : "no se observó respuesta de Storage en 15s";
      const pollingDetails =
        pollingError instanceof Error ? ` ${pollingError.message}` : "";
      throw new Error(
        `El estado remoto del DeCA no llegó a EMITIDO. Petición de finalización: ${finalizeRequestDetails}. Respuesta de finalización: ${finalizeResponseDetails}. Respuesta de Storage: ${storageResponseDetails}.${pollingDetails}`,
      );
    }
    if (uploadResponseResult.status === "fulfilled") {
      const uploadResponse = uploadResponseResult.value;
      const uploadStatus = uploadResponse.status();
      const responseBody =
        storageResponseBody ?? (await uploadResponse.text());
      expect(
        uploadStatus === 200 ||
          uploadStatus === 201 ||
          isExistingStorageObjectResponse(uploadResponse, responseBody),
      ).toBe(true);
      expect(uploadResponse.url()).toContain(expectedPath);
    }
    expect(emitted.estado).toBe("EMITIDO");
    expect(emitted.pdf_public_url).toBeTruthy();
    expect(emitted.pdf_public_url).toMatch(/^https:\/\//);
    expect(emitted.pdf_sha256).toMatch(/^[a-f0-9]{64}$/i);

    const pdf = await downloadPdf(context, String(emitted.pdf_public_url));
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(
      emitted.pdf_sha256,
    );

    await expect(page.getByRole("button", { name: "Abrir PDF oficial" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Emitir DeCA" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Finalizar emisión|Reintentar emisión/ })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test.skip(
    "decodifica el QR del PDF oficial (requiere un renderizador PDF)",
    async () => {},
  );

  test("rechaza URL oficial con host o bucket incorrectos", async ({ page }) => {
    for (const corruption of ["host", "bucket"] as const) {
      const deca = await createDraft(page);
      await reserveDraft(page, deca.marker);
      await corruptNextPublicPdfUrl(page, corruption);

      let uploadAttempted = false;
      const onRequest = (request: Request) => {
        if (isOfficialPdfUpload(request)) uploadAttempted = true;
      };
      page.on("request", onRequest);

      await page.getByRole("button", { name: "Finalizar emisión" }).click();
      await expect(page.getByRole("alert")).toContainText(/URL|endpoint|bucket/i);
      expect(uploadAttempted).toBe(false);
      await expect(
        page.getByRole("button", { name: "Reintentar emisión" }),
      ).toBeVisible();
      page.off("request", onRequest);

      await page.getByRole("button", { name: "Volver a Mis DeCAs" }).click();
    }
  });

  test("dos pestañas finalizan concurrentemente la misma reserva", async ({
    page,
    context,
  }) => {
    const deca = await createDraft(page);
    const reservation = await reserveDraft(page, deca.marker);
    const requestId = String(reservation.emission_request_id);
    const expectedPath = `${reservation.user_id}/${reservation.id}/v1-${requestId}.pdf`;

    const secondPage = await context.newPage();
    await secondPage.goto(stagingUrl!);
    await secondPage
      .getByRole("navigation", { name: "Secciones principales" })
      .getByRole("button", { name: "DeCAs" })
      .click();
    await expect(secondPage.getByRole("heading", { name: "Mis DeCAs" })).toBeVisible();
    await openDeCA(secondPage, deca.marker);

    let preflightCount = 0;
    let releasePreflights!: () => void;
    const bothPreflights = new Promise<void>((resolve) => {
      releasePreflights = resolve;
    });
    let remoteReadRequest: Request | undefined;
    const holdPreflight = async (route: Route) => {
      const requestUrl = new URL(route.request().url());
      if (
        route.request().method() === "GET" &&
        requestUrl.searchParams.get("id") === `eq.${reservation.id}`
      ) {
        remoteReadRequest = route.request();
        preflightCount += 1;
        if (preflightCount === 2) releasePreflights();
        await Promise.race([bothPreflights, delay(10_000)]);
      }
      await route.continue();
    };
    await page.route("**/rest/v1/decas**", holdPreflight);
    await secondPage.route("**/rest/v1/decas**", holdPreflight);

    const uploads: Request[] = [];
    const uploadResponses: Response[] = [];
    const onUpload = (request: Request) => {
      if (isOfficialPdfUpload(request)) uploads.push(request);
    };
    const onUploadResponse = (response: Response) => {
      if (isOfficialPdfUpload(response.request())) uploadResponses.push(response);
    };
    page.on("request", onUpload);
    secondPage.on("request", onUpload);
    page.on("response", onUploadResponse);
    secondPage.on("response", onUploadResponse);

    const responseOne = page.waitForResponse((response) =>
      isFinalizeRequest(response.request()),
    );
    const responseTwo = secondPage.waitForResponse((response) =>
      isFinalizeRequest(response.request()),
    );
    await Promise.all([
      page.getByRole("button", { name: "Finalizar emisión" }).click(),
      secondPage.getByRole("button", { name: "Finalizar emisión" }).click(),
    ]);
    const [finalizeOne, finalizeTwo] = await Promise.all([responseOne, responseTwo]);
    expect(preflightCount).toBe(2);
    expect(uploads).toHaveLength(2);
    expect(uploads.every((request) => request.url().includes(expectedPath))).toBe(true);

    const rows = await Promise.all([
      maybeResponseRow(finalizeOne),
      maybeResponseRow(finalizeTwo),
    ]);
    const nonNullRows = rows.filter(
      (row): row is EmittedDecaRow => row !== null,
    );
    let emitted = nonNullRows.find((row) => row.estado === "EMITIDO");
    expect(remoteReadRequest).toBeTruthy();
    const requestHeaders = await remoteReadRequest!.allHeaders();
    expect(requestHeaders.apikey).toBeTruthy();
    expect(requestHeaders.authorization).toBeTruthy();
    const headers = {
      apikey: requestHeaders.apikey,
      authorization: requestHeaders.authorization,
      accept: "application/json",
    };
    await expect
      .poll(
        async () => {
          const current = await getRemoteDeca(
            context,
            remoteReadRequest!.url(),
            headers,
          );
          emitted = current?.estado === "EMITIDO" ? current : undefined;
          return emitted?.estado ?? null;
        },
        { timeout: 10_000, intervals: [250, 500, 1000] },
      )
      .toBe("EMITIDO");
    if (!emitted) {
      throw new Error("El estado remoto del DeCA no llegó a EMITIDO.");
    }
    expect(emitted.estado).toBe("EMITIDO");

    const pdf = await downloadPdf(context, String(emitted.pdf_public_url));
    const finalHash = createHash("sha256").update(pdf).digest("hex");
    expect(finalHash).toBe(emitted.pdf_sha256);

    expect(uploadResponses).toHaveLength(2);
    const uploadResults = await Promise.all(
      uploadResponses.map(async (response) => ({
        response,
        body: await response.text(),
      })),
    );
    const successfulUploads = uploadResults.filter(({ response }) =>
      [200, 201].includes(response.status()),
    );
    const conflictUploads = uploadResults.filter(
      ({ response, body }) =>
        response.status() === 409 ||
        (response.status() === 400 &&
          isExistingStorageObjectResponse(response, body)),
    );
    const unexpectedUploads = uploadResults.filter(
      ({ response, body }) =>
        ![200, 201].includes(response.status()) &&
        !(
          response.status() === 409 ||
          (response.status() === 400 &&
            isExistingStorageObjectResponse(response, body))
        ),
    );
    if (unexpectedUploads.length > 0) {
      const details = unexpectedUploads
        .map(
          ({ response, body }) =>
            `HTTP ${response.status()} ${response.url()} body: ${body}`,
        )
        .join("\n");
      throw new Error(`Respuesta inesperada de upload de Storage:\n${details}`);
    }
    expect(successfulUploads).toHaveLength(1);
    expect(conflictUploads).toHaveLength(1);
    const successfulUploadRequest = successfulUploads[0].response.request();

    const uploadUrl = new URL(successfulUploadRequest.url());
    const storageObjectPrefixIndex = uploadUrl.pathname.indexOf(
      "/storage/v1/object/",
    );
    expect(storageObjectPrefixIndex).toBeGreaterThanOrEqual(0);
    uploadUrl.pathname = `${uploadUrl.pathname.slice(
      0,
      storageObjectPrefixIndex,
    )}/storage/v1/object/deca-pdf/${emitted.pdf_path}`;
    uploadUrl.search = "";
    uploadUrl.hash = "";
    const storageObjectResponse = await context.request.get(uploadUrl.href, {
      headers: {
        apikey: requestHeaders.apikey,
        authorization: requestHeaders.authorization,
      },
    });
    expect(
      storageObjectResponse.ok(),
      `No se pudo descargar el objeto autenticado: HTTP ${storageObjectResponse.status()} ${uploadUrl.href} ${await storageObjectResponse.text()}`,
    ).toBe(true);
    const storageObjectBytes = await storageObjectResponse.body();
    const storageObjectHash = createHash("sha256")
      .update(storageObjectBytes)
      .digest("hex");
    const hashDiagnostic =
      `storageObjectHash=${storageObjectHash}, finalHash=${finalHash}, emitted.pdf_sha256=${emitted.pdf_sha256}, pdf_path=${emitted.pdf_path}, pdf_public_url=${emitted.pdf_public_url}`;
    expect(storageObjectHash, hashDiagnostic).toBe(finalHash);
    await expect(
      page.getByRole("button", { name: "Abrir PDF oficial" }),
    ).toBeVisible();
    await expect(
      secondPage.getByRole("button", { name: "Abrir PDF oficial" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(secondPage.getByRole("alert")).toHaveCount(0);
    await secondPage.close();
  });
});

async function signIn(page: Page) {
  await page.goto(stagingUrl!);
  const signInHeading = page.getByRole("heading", { name: "Iniciar sesión" });
  if (await signInHeading.isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Contraseña").fill(password!);
    await page.getByRole("button", { name: "Entrar" }).click();
  }
  await page
    .getByRole("navigation", { name: "Secciones principales" })
    .getByRole("button", { name: "DeCAs" })
    .click();
  await expect(page.getByRole("heading", { name: "Mis DeCAs" })).toBeVisible({
    timeout: 30_000,
  });
}

async function createDraft(page: Page) {
  const marker = `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await page.getByRole("button", { name: "Nuevo DeCA" }).click();
  await page.locator("#deca-fecha").fill(new Date().toISOString().slice(0, 10));
  await page.locator("#deca-cargador").fill(`${marker} Cargador`);
  await page.locator("#deca-destinatario").fill(`${marker} Destinatario`);
  await page.locator("#deca-direccion").fill("Calle de pruebas 1");
  await page.locator("#deca-ciudad").fill("Madrid");
  await page.locator("#deca-mercancia").fill("Mercancía E2E");
  await page.locator("#deca-matricula").fill("1234ABC");

  const insertResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isDecasRestRequest(response.request()),
  );
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  const row = await responseRow(await insertResponse);
  return { marker, row };
}

async function reserveDraft(page: Page, marker: string) {
  await openDeCA(page, marker);
  page.once("dialog", (dialog) => void dialog.accept());
  const reserveResponse = page.waitForResponse(
    (response) => isReservationRequest(response.request()) && response.ok(),
  );
  await page.getByRole("button", { name: "Emitir DeCA" }).click();
  const row = await responseRow(await reserveResponse);
  await page.getByRole("button", { name: "Volver a Mis DeCAs" }).click();
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const decaRow = page.getByTestId(`deca-row-${row.id}`);
  await expect(decaRow).toBeVisible({ timeout: 10_000 });
  await decaRow.click();
  await expect(
    page.locator("span.rounded-full").filter({ hasText: /^EMITIENDO$/ }),
  ).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByRole("button", { name: "Finalizar emisión" })).toBeVisible({
    timeout: 5000,
  });
  return row;
}

async function openDeCA(page: Page, marker: string) {
  await page
    .locator("button")
    .filter({ hasText: `${marker} Destinatario` })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: `${marker} Destinatario` })).toBeVisible();
}

function isDecasRestRequest(request: Request) {
  return new URL(request.url()).pathname.endsWith("/rest/v1/decas");
}

function requestBody(request: Request): Record<string, unknown> {
  try {
    return request.postDataJSON() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isReservationRequest(request: Request) {
  return (
    request.method() === "PATCH" &&
    isDecasRestRequest(request) &&
    requestBody(request).estado === "EMITIENDO"
  );
}

function isFinalizeRequest(request: Request) {
  return (
    request.method() === "PATCH" &&
    isDecasRestRequest(request) &&
    requestBody(request).estado === "EMITIDO"
  );
}

function isOfficialPdfUpload(request: Request) {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname.includes("/storage/v1/object/deca-pdf/")
  );
}

function isExistingStorageObjectResponse(
  response: Response,
  body: string,
): boolean {
  if (response.status() === 409) return true;
  if (response.status() !== 400) return false;

  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object") return false;
    const storageError = payload as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
      statusCode?: unknown;
    };
    const duplicateSignals = new Set([
      "Duplicate",
      "ResourceAlreadyExists",
      "KeyAlreadyExists",
    ]);
    const hasDuplicateSignal =
      duplicateSignals.has(String(storageError.error)) ||
      duplicateSignals.has(String(storageError.code)) ||
      (typeof storageError.message === "string" &&
        /already exists/i.test(storageError.message));
    return String(storageError.statusCode) === "409" && hasDuplicateSignal;
  } catch {
    return false;
  }
}

async function responseRow(response: Response) {
  expect(response.ok(), `Respuesta inesperada: ${response.status()}`).toBe(true);
  const body: unknown = await response.json();
  const row = Array.isArray(body) ? body[0] : body;
  expect(row).toBeTruthy();
  return row as Record<string, unknown>;
}

async function maybeResponseRow(response: Response) {
  expect(response.ok(), `Respuesta inesperada: ${response.status()}`).toBe(true);
  const body: unknown = await response.json();
  const row = Array.isArray(body) ? body[0] : body;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

async function getRemoteDeca(
  context: BrowserContext,
  requestUrl: string,
  headers: Record<string, string>,
): Promise<EmittedDecaRow | null> {
  const response = await context.request.get(requestUrl, { headers });
  expect(response.ok(), `Consulta remota inesperada: ${response.status()}`).toBe(
    true,
  );
  const body: unknown = await response.json();
  const row = Array.isArray(body) ? body[0] : body;
  return row && typeof row === "object" ? (row as EmittedDecaRow) : null;
}

async function downloadPdf(
  context: BrowserContext,
  pdfUrl: string,
): Promise<Buffer> {
  const response = await context.request.get(pdfUrl);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("application/pdf");
  return response.body();
}

async function corruptNextPublicPdfUrl(page: Page, corruption: "host" | "bucket") {
  await page.evaluate((mode) => {
    const targetWindow = window as typeof window & {
      __e2eNativeUrl?: typeof URL;
    };
    const nativeUrl = targetWindow.__e2eNativeUrl ?? window.URL;
    targetWindow.__e2eNativeUrl = nativeUrl;
    const patchedUrl = new Proxy(nativeUrl, {
      construct(target, args) {
        const parsed = Reflect.construct(target, args) as URL;
        if (parsed.pathname.includes("/object/public/deca-pdf/")) {
          if (mode === "host") parsed.hostname = "invalid.example";
          else parsed.pathname = parsed.pathname.replace(
            "/deca-pdf/",
            "/wrong-bucket/",
          );
        }
        return parsed;
      },
    });
    Object.defineProperty(window, "URL", {
      configurable: true,
      value: patchedUrl,
    });
  }, corruption);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
