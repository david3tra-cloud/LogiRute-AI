const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type IdentityError = { type?: string; message?: string };
type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};
type IdentityServices = {
  initTokenClient: (options: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback: (error: IdentityError) => void;
  }) => TokenClient;
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: IdentityServices } };
  }
}

export type DriveUploadResult = {
  fileId: string;
  fileUrl: string;
  fileName: string;
};

export type DriveFailureKind =
  | "not-configured"
  | "origin-not-authorized"
  | "cancelled"
  | "popup-blocked"
  | "permission"
  | "network"
  | "upload";

export class DriveServiceError extends Error {
  constructor(readonly kind: DriveFailureKind) {
    super(kind);
    this.name = "DriveServiceError";
  }
}

let identityScriptPromise: Promise<void> | undefined;

export const isGoogleDriveConfigured = () =>
  Boolean(import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim());

const isUnauthorizedOriginError = (value?: string) =>
  /origin[_ -]?(?:mismatch|not[_ -]?authorized)|unauthorized[_ -]?client|invalid[_ -]?client/i.test(
    value ?? "",
  );

export const loadGoogleIdentityServices = async () => {
  if (window.google?.accounts?.oauth2) return;
  if (!identityScriptPromise) {
    identityScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.google?.accounts?.oauth2) resolve();
        else reject(new DriveServiceError("network"));
      };
      script.onerror = () => {
        script.remove();
        reject(new DriveServiceError("network"));
      };
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      identityScriptPromise = undefined;
      throw error;
    });
  }
  await identityScriptPromise;
};

export const requestDriveAccessToken = (
  onStatus?: (status: "connecting") => void,
): Promise<string> => {
  onStatus?.("connecting");
  const clientId = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim();
  if (!clientId) {
    return Promise.reject(new DriveServiceError("not-configured"));
  }
  const identity = window.google?.accounts?.oauth2;
  if (!identity) {
    return loadGoogleIdentityServices().then(() =>
      requestDriveAccessToken(onStatus),
    );
  }

  return new Promise<string>((resolve, reject) => {
    const client = identity.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else if (
          isUnauthorizedOriginError(
            `${response.error ?? ""} ${response.error_description ?? ""}`,
          )
        ) {
          reject(new DriveServiceError("origin-not-authorized"));
        } else if (response.error === "access_denied") {
          reject(new DriveServiceError("cancelled"));
        } else {
          reject(new DriveServiceError("permission"));
        }
      },
      error_callback: (error) => {
        const details = `${error.type ?? ""} ${error.message ?? ""}`;
        const kind: DriveFailureKind = isUnauthorizedOriginError(details)
          ? "origin-not-authorized"
          : error.type === "popup_failed_to_open"
            ? "popup-blocked"
            : error.type === "popup_closed"
              ? "cancelled"
              : "permission";
        reject(new DriveServiceError(kind));
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
};

const fallbackFileUrl = (fileId: string) =>
  `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;

export const uploadDeCAPdf = async (options: {
  blob: Blob;
  fileName: string;
  documentoId: string;
  accessToken: string;
  existingFileId?: string;
}): Promise<DriveUploadResult> => {
  const accessToken = options.accessToken;
  const metadata = {
    name: options.fileName,
    mimeType: "application/pdf",
    appProperties: {
      app: "logiroute-ai",
      documentoId: options.documentoId,
    },
  };
  const boundary = `logiroute_${globalThis.crypto.randomUUID()}`;
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
      options.blob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );

  const isUpdate = Boolean(options.existingFileId);
  const endpoint = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(options.existingFileId!)}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(endpoint, {
      method: isUpdate ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
  } catch {
    throw new DriveServiceError("network");
  }
  if (!uploadResponse.ok) {
    throw new DriveServiceError(
      uploadResponse.status === 401 || uploadResponse.status === 403
        ? "permission"
        : "upload",
    );
  }

  let uploadedFile: { id?: string; name?: string };
  try {
    uploadedFile = (await uploadResponse.json()) as {
      id?: string;
      name?: string;
    };
  } catch {
    throw new DriveServiceError("upload");
  }
  const fileId = uploadedFile.id || options.existingFileId;
  if (!fileId) throw new DriveServiceError("upload");

  let fileUrl = fallbackFileUrl(fileId);
  try {
    const linkResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id%2CwebViewLink%2Cname`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (linkResponse.ok) {
      const file = (await linkResponse.json()) as {
        webViewLink?: string;
        name?: string;
      };
      fileUrl = file.webViewLink || fileUrl;
      return {
        fileId,
        fileUrl,
        fileName: file.name || uploadedFile.name || options.fileName,
      };
    }
  } catch {
    // El enlace de respaldo permite abrir el archivo aunque no se obtenga webViewLink.
  }

  return {
    fileId,
    fileUrl,
    fileName: uploadedFile.name || options.fileName,
  };
};
