export type DachserRegionName =
  | "fecha"
  | "referenciaExpedicion"
  | "numeroBultos"
  | "pesoKg"
  | "consignatario";

export type DachserRegionTexts = Record<DachserRegionName, string>;

export type ImageDimensions = { width: number; height: number };

type Region = { x: number; y: number; width: number; height: number };

type RegionalOCRWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

const REGIONS: Record<DachserRegionName, Region> = {
  fecha: { x: 0.397, y: 0.265, width: 0.08, height: 0.075 },
  referenciaExpedicion: {
    x: 0.475,
    y: 0.265,
    width: 0.09,
    height: 0.075,
  },
  numeroBultos: { x: 0.66, y: 0.203, width: 0.067, height: 0.084 },
  pesoKg: { x: 0.628, y: 0.265, width: 0.061, height: 0.074 },
  consignatario: { x: 0.392, y: 0.377, width: 0.354, height: 0.198 },
};

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    image.src = dataUrl;
  });

export const getImageDimensions = async (
  dataUrl: string,
): Promise<ImageDimensions> => {
  const image = await loadImage(dataUrl);
  return { width: image.naturalWidth, height: image.naturalHeight };
};

const normalizeText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

export const DACHSER_SIGNAL_LABELS = {
  remitente: "REMITENTE",
  consignatario: "CONSIGNATARIO",
  fecha: "FECHA",
  referencia: "REF. EXPED. / REF. ADMON.",
  bultos: "BULTOS",
  peso: "PESO",
} as const;

export type DachserTemplateSignals = Record<
  keyof typeof DACHSER_SIGNAL_LABELS,
  boolean
>;

const levenshteinDistance = (left: string, right: string) => {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const saved = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
      previous = saved;
    }
  }
  return row[right.length];
};

const tokenMatches = (token: string, expected: string) => {
  if (token === expected) return true;
  if (token.length < 4 || expected.length < 4) return false;
  const distance = levenshteinDistance(token, expected);
  const similarity = 1 - distance / Math.max(token.length, expected.length);
  return (
    distance <= Math.max(1, Math.floor(expected.length * 0.2)) &&
    similarity >= 0.75
  );
};

export const detectDachserTemplateSignals = (
  text: string,
): DachserTemplateSignals => {
  const tokens = normalizeText(text).match(/[A-Z0-9]+/g) ?? [];
  const hasToken = (expected: string) =>
    tokens.some((token) => tokenMatches(token, expected));
  const hasReferencePair = (referenceKind: string) =>
    tokens.some(
      (token, index) =>
        token === "REF" &&
        tokens
          .slice(index + 1, index + 3)
          .some((nextToken) => tokenMatches(nextToken, referenceKind)),
    );

  return {
    remitente: hasToken("REMITENTE"),
    consignatario: hasToken("CONSIGNATARIO"),
    fecha: hasToken("FECHA"),
    referencia: hasReferencePair("EXPED") || hasReferencePair("ADMON"),
    bultos: hasToken("BULTOS"),
    peso: hasToken("PESO"),
  };
};

export const looksLikeDachserTemplate = (text: string) =>
  Object.values(detectDachserTemplateSignals(text)).filter(Boolean).length >= 3;

export const recognizeDachserRegions = async (
  dataUrl: string,
  onProgress?: (progress: number) => void,
): Promise<DachserRegionTexts> => {
  const image = await loadImage(dataUrl);
  if (image.naturalWidth <= image.naturalHeight) {
    throw new Error("La imagen debe estar en orientación horizontal.");
  }

  const { createWorker } = (await import("tesseract.js")) as unknown as {
    createWorker: (
      language: string,
      oem: undefined,
      options: {
        workerPath: string;
        corePath: string;
        langPath: string;
        gzip: boolean;
        workerBlobURL: boolean;
        logger: (message: { progress: number }) => void;
      },
    ) => Promise<RegionalOCRWorker>;
  };

  const worker = await createWorker("spa", undefined, {
    workerPath: new URL("/tesseract/worker.min.js", window.location.origin)
      .href,
    corePath: new URL("/tesseract/core/", window.location.origin).href,
    langPath: new URL("/tesseract/lang/", window.location.origin).href,
    gzip: true,
    workerBlobURL: false,
    logger: () => undefined,
  });

  const regionNames = Object.keys(REGIONS) as DachserRegionName[];
  const texts = {} as DachserRegionTexts;
  const scale = 3;

  try {
    for (const [index, name] of regionNames.entries()) {
      const region = REGIONS[name];
      const sourceX = Math.round(region.x * image.naturalWidth);
      const sourceY = Math.round(region.y * image.naturalHeight);
      const sourceWidth = Math.max(
        1,
        Math.round(region.width * image.naturalWidth),
      );
      const sourceHeight = Math.max(
        1,
        Math.round(region.height * image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = sourceWidth * scale;
      canvas.height = sourceHeight * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar el recorte OCR.");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      try {
        const result = await worker.recognize(canvas);
        texts[name] = result.data.text.trim();
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
      onProgress?.((index + 1) / regionNames.length);
    }
    return texts;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
};
