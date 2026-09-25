import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Plus, Trash2, Upload } from "lucide-react";
import { DeCA } from "./types";

const STORAGE_KEY = "transport_app_decas";

type DeCAForm = Pick<
  DeCA,
  | "fecha"
  | "destinatario"
  | "direccionDestino"
  | "ciudadDestino"
  | "mercancia"
  | "pesoOBultos"
  | "referenciaAlbaran"
  | "matriculaVehiculo"
  | "notas"
> &
  Pick<DeCA, "fotoAlbaran" | "nombreFotoAlbaran">;

type SectionView = "list" | "form" | "detail";
type OCRWorker = {
  recognize: (image: string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

const OCR_LABELS =
  /\b(?:fecha|albar[aá]n|ref(?:erencia)?|peso|kg|bultos?|palets?|unidades|destinatario|cliente|direcci[oó]n|poblaci[oó]n|ciudad)\b/i;

const uniqueValue = (values: string[]) => {
  const distinct = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return distinct.length === 1 ? distinct[0] : undefined;
};

const extractLabelValue = (lines: string[], label: RegExp) => {
  const values: string[] = [];
  lines.forEach((line, index) => {
    const match = label.exec(line);
    if (!match) return;
    let value = line
      .slice(match.index + match[0].length)
      .replace(/^[\s:;#№º°.-]+/, "")
      .trim();
    if (!value) {
      const nextLine = lines[index + 1]?.trim();
      if (
        nextLine &&
        !new RegExp(`^${OCR_LABELS.source}[\\s:;#№º°.-]*$`, "i").test(nextLine)
      ) {
        value = nextLine;
      }
    }
    if (value) values.push(value);
  });
  return uniqueValue(values);
};

const extractSuggestions = (text: string): Partial<DeCAForm> => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const suggestions: Partial<DeCAForm> = {};
  const dateValues: string[] = [];
  for (const match of text.matchAll(
    /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/g,
  )) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      dateValues.push(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
  }
  const fecha = uniqueValue(dateValues);
  if (fecha) suggestions.fecha = fecha;

  const referencia = extractLabelValue(
    lines,
    /\b(?:albar[aá]n|referencia|ref)\b/i,
  );
  if (referencia) suggestions.referenciaAlbaran = referencia;

  const weights = [
    ...text.matchAll(
      /(?:^|[^\d.])((?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d+)?\s*kg)\b/gi,
    ),
  ].map((match) => match[1].replace(/\s+/g, " "));
  const packages = [
    ...text.matchAll(/\b\d+\s*(?:bultos?|palets?|unidades)\b/gi),
  ].map((match) => match[0].replace(/\s+/g, " "));
  const uniqueWeight = uniqueValue(weights);
  const uniquePackages = uniqueValue(packages);
  if (uniqueWeight || uniquePackages) {
    suggestions.pesoOBultos = [uniqueWeight, uniquePackages]
      .filter(Boolean)
      .join("; ");
  }

  const destinatario = extractLabelValue(
    lines,
    /\b(?:destinatario|cliente)\b/i,
  );
  const direccionDestino = extractLabelValue(lines, /\bdirecci[oó]n\b/i);
  const ciudadDestino = extractLabelValue(
    lines,
    /\b(?:poblaci[oó]n|ciudad)\b/i,
  );
  if (destinatario) suggestions.destinatario = destinatario;
  if (direccionDestino) suggestions.direccionDestino = direccionDestino;
  if (ciudadDestino) suggestions.ciudadDestino = ciudadDestino;

  return suggestions;
};

const getToday = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const createEmptyForm = (): DeCAForm => ({
  fecha: getToday(),
  destinatario: "",
  direccionDestino: "",
  ciudadDestino: "",
  mercancia: "",
  pesoOBultos: "",
  referenciaAlbaran: "",
  matriculaVehiculo: "",
  notas: "",
});

const loadDecas = (): DeCA[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const formatDate = (date: string) => {
  if (!date) return "Sin fecha";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
};

const DeCASection: React.FC = () => {
  const [decas, setDecas] = useState<DeCA[]>(loadDecas);
  const [view, setView] = useState<SectionView>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<DeCAForm>(createEmptyForm);
  const [photoError, setPhotoError] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [detectedText, setDetectedText] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const ocrWorkerRef = useRef<OCRWorker | null>(null);
  const mountedRef = useRef(true);
  const editedFieldsRef = useRef(new Set<keyof DeCAForm>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const worker = ocrWorkerRef.current;
      ocrWorkerRef.current = null;
      if (worker) void worker.terminate().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decas));
    } catch {
      // La sección sigue siendo utilizable aunque el navegador no permita persistir.
    }
  }, [decas]);

  const selectedDeCA = decas.find((deca) => deca.id === selectedId);

  const updateField = (field: keyof DeCAForm, value: string) => {
    editedFieldsRef.current.add(field);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setDetectedText(null);
    setOcrError("");
    setCopyMessage("");

    if (!file.type.startsWith("image/")) {
      setPhotoError("El archivo seleccionado no es una imagen.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError(
        "La imagen supera 5 MB. Haz una foto con menos calidad o selecciona otra.",
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setPhotoError("No se pudo leer la imagen. Selecciona otra.");
        return;
      }
      setForm((current) => ({
        ...current,
        fotoAlbaran: reader.result as string,
        nombreFotoAlbaran: file.name,
      }));
      setPhotoError("");
    };
    reader.onerror = () =>
      setPhotoError("No se pudo leer la imagen. Selecciona otra.");
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setForm((current) => {
      const {
        fotoAlbaran: _fotoAlbaran,
        nombreFotoAlbaran: _nombreFotoAlbaran,
        ...rest
      } = current;
      return rest;
    });
    setPhotoError("");
    setDetectedText(null);
    setOcrError("");
    setCopyMessage("");
  };

  const handleReadReceipt = async () => {
    if (!form.fotoAlbaran || ocrLoading) return;
    setOcrLoading(true);
    setOcrProgress(0);
    setOcrError("");
    setDetectedText(null);
    setCopyMessage("");

    let worker: OCRWorker | null = null;
    try {
      const tesseract = await import("tesseract.js");
      if (!mountedRef.current) return;
      const moduleApi = tesseract as unknown as {
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
        ) => Promise<OCRWorker>;
      };
      worker = await moduleApi.createWorker("spa", undefined, {
        workerPath: new URL("/tesseract/worker.min.js", window.location.origin)
          .href,
        corePath: new URL("/tesseract/core/", window.location.origin).href,
        langPath: new URL("/tesseract/lang/", window.location.origin).href,
        gzip: true,
        workerBlobURL: false,
        logger: ({ progress }) => {
          if (mountedRef.current) setOcrProgress(Math.round(progress * 100));
        },
      });
      if (!mountedRef.current) return;
      ocrWorkerRef.current = worker;

      const result = await worker.recognize(form.fotoAlbaran);
      if (!mountedRef.current) return;
      const text = result.data.text.trim();
      setDetectedText(text);
      const suggestions = extractSuggestions(text);
      setForm((current) => {
        const next = { ...current };
        (Object.keys(suggestions) as (keyof DeCAForm)[]).forEach((field) => {
          const value = suggestions[field];
          if (!value || editedFieldsRef.current.has(field)) return;
          if (field !== "fecha" && current[field]?.trim()) return;
          next[field] = value;
        });
        return next;
      });
    } catch {
      if (mountedRef.current) {
        setOcrError(
          "No se pudo leer el albarán. Prueba con una foto más nítida, bien iluminada y sin reflejos.",
        );
      }
    } finally {
      if (worker) {
        if (ocrWorkerRef.current === worker) ocrWorkerRef.current = null;
        await worker.terminate().catch(() => undefined);
      }
      if (mountedRef.current) setOcrLoading(false);
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(detectedText ?? "");
      setCopyMessage("Texto copiado.");
    } catch {
      setCopyMessage("No se pudo copiar el texto desde este navegador.");
    }
  };

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const now = new Date().toISOString();
    const newDeCA: DeCA = {
      ...form,
      id:
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      cargador: "Cargador habitual",
      transportista: "David Pascual",
      estado: "borrador",
      createdAt: now,
      updatedAt: now,
      ...(form.fotoAlbaran ? { fotoAlbaran: form.fotoAlbaran } : {}),
      ...(form.nombreFotoAlbaran
        ? { nombreFotoAlbaran: form.nombreFotoAlbaran }
        : {}),
    };

    setDecas((current) => [newDeCA, ...current]);
    setSelectedId(null);
    setForm(createEmptyForm());
    setPhotoError("");
    editedFieldsRef.current.clear();
    setDetectedText(null);
    setView("list");
  };

  const handleDelete = () => {
    if (!selectedDeCA || !window.confirm("¿Eliminar este borrador DeCA?"))
      return;
    setDecas((current) =>
      current.filter((deca) => deca.id !== selectedDeCA.id),
    );
    setSelectedId(null);
    setView("list");
  };

  const startNewDeCA = () => {
    setForm(createEmptyForm());
    setPhotoError("");
    setOcrError("");
    setDetectedText(null);
    editedFieldsRef.current.clear();
    setView("form");
  };

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const labelClass = "mb-1.5 block text-xs font-bold text-slate-600";

  return (
    <div className="min-h-full bg-slate-50 px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-5xl">
        {view === "list" && (
          <>
            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <h1 className="text-2xl font-black text-slate-900">
                  Mis DeCAs
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Documentos de control de transporte
                </p>
              </div>
              <button
                type="button"
                onClick={startNewDeCA}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
              >
                <Plus size={17} /> Nuevo DeCA
              </button>
            </div>

            {decas.length === 0 ? (
              <div className="border-y border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
                Aún no tienes ningún DeCA. Crea el primero.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
                {decas.map((deca) => (
                  <button
                    key={deca.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(deca.id);
                      setView("detail");
                    }}
                    className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-blue-50/50 sm:grid-cols-[1fr_1.4fr_1fr_1.2fr_auto] sm:items-center sm:px-5"
                  >
                    <span className="text-sm font-semibold text-slate-700">
                      {formatDate(deca.fecha)}
                    </span>
                    <span className="min-w-0 truncate text-sm font-bold text-slate-900">
                      {deca.destinatario}
                    </span>
                    <span className="text-sm text-slate-600">
                      {deca.ciudadDestino}
                    </span>
                    <span className="min-w-0 truncate text-sm text-slate-600">
                      {deca.mercancia}
                    </span>
                    <span className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="text-xs text-slate-500">
                        {deca.pesoOBultos}
                      </span>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-800">
                        Borrador
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {view === "form" && (
          <div className="mx-auto max-w-3xl">
            <button
              type="button"
              onClick={() => setView("list")}
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={17} /> Volver a Mis DeCAs
            </button>
            <div className="border-y border-slate-200 bg-white px-4 py-5 sm:px-7">
              <div className="mb-5 flex items-center gap-3">
                <FileText className="text-blue-700" size={22} />
                <h1 className="text-xl font-black text-slate-900">
                  Nuevo DeCA
                </h1>
              </div>
              <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="deca-fecha">
                    Fecha
                  </label>
                  <input
                    id="deca-fecha"
                    className={inputClass}
                    type="date"
                    required
                    value={form.fecha}
                    onChange={(event) =>
                      updateField("fecha", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-destinatario">
                    Destinatario o empresa
                  </label>
                  <input
                    id="deca-destinatario"
                    className={inputClass}
                    required
                    value={form.destinatario}
                    onChange={(event) =>
                      updateField("destinatario", event.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="deca-direccion">
                    Dirección de destino
                  </label>
                  <input
                    id="deca-direccion"
                    className={inputClass}
                    required
                    value={form.direccionDestino}
                    onChange={(event) =>
                      updateField("direccionDestino", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-ciudad">
                    Ciudad de destino
                  </label>
                  <input
                    id="deca-ciudad"
                    className={inputClass}
                    required
                    value={form.ciudadDestino}
                    onChange={(event) =>
                      updateField("ciudadDestino", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-mercancia">
                    Mercancía
                  </label>
                  <input
                    id="deca-mercancia"
                    className={inputClass}
                    required
                    value={form.mercancia}
                    onChange={(event) =>
                      updateField("mercancia", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-peso">
                    Peso o número de bultos
                  </label>
                  <input
                    id="deca-peso"
                    className={inputClass}
                    required
                    value={form.pesoOBultos}
                    onChange={(event) =>
                      updateField("pesoOBultos", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="deca-albaran">
                    Referencia de albarán (opcional)
                  </label>
                  <input
                    id="deca-albaran"
                    className={inputClass}
                    value={form.referenciaAlbaran}
                    onChange={(event) =>
                      updateField("referenciaAlbaran", event.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="deca-matricula">
                    Matrícula del vehículo
                  </label>
                  <input
                    id="deca-matricula"
                    className={inputClass}
                    required
                    value={form.matriculaVehiculo}
                    onChange={(event) =>
                      updateField("matriculaVehiculo", event.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="deca-notas">
                    Notas (opcional)
                  </label>
                  <textarea
                    id="deca-notas"
                    className={`${inputClass} min-h-24 resize-y`}
                    value={form.notas}
                    onChange={(event) =>
                      updateField("notas", event.target.value)
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <span className={labelClass}>
                    Foto del albarán (opcional)
                  </span>
                  <input
                    ref={cameraInputRef}
                    className="hidden"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoChange}
                  />
                  <input
                    ref={galleryInputRef}
                    className="hidden"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      <FileText size={16} /> Hacer foto
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Upload size={16} /> Elegir foto
                    </button>
                  </div>
                  {form.fotoAlbaran && (
                    <>
                      <div className="mt-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 sm:p-4">
                        <h2 className="text-sm font-bold text-slate-900">
                          Revisar albarán
                        </h2>
                        {form.nombreFotoAlbaran && (
                          <p className="break-all text-xs text-slate-600">
                            {form.nombreFotoAlbaran}
                          </p>
                        )}
                        <img
                          src={form.fotoAlbaran}
                          alt="Vista previa del albarán"
                          className="max-h-[60vh] w-full rounded-lg border border-slate-200 bg-white object-contain"
                        />
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={handleReadReceipt}
                            disabled={ocrLoading}
                            className="min-h-11 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
                          >
                            {ocrLoading
                              ? "Leyendo albarán…"
                              : "Leer datos del albarán"}
                          </button>
                          {ocrLoading && (
                            <p role="status" className="text-sm text-slate-600">
                              Leyendo albarán… {ocrProgress}%
                            </p>
                          )}
                          {ocrError && (
                            <p
                              role="alert"
                              className="text-sm font-medium text-red-700"
                            >
                              {ocrError}
                            </p>
                          )}
                          {detectedText !== null && (
                            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-bold text-slate-900">
                                  Texto detectado
                                </h3>
                                <button
                                  type="button"
                                  onClick={handleCopyText}
                                  className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                                >
                                  Copiar texto
                                </button>
                              </div>
                              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                                {detectedText ||
                                  "No se detectó texto en la imagen."}
                              </pre>
                              <p className="text-sm font-semibold leading-5 text-amber-800">
                                Datos sugeridos por OCR. Revísalos antes de
                                guardar: pueden contener errores.
                              </p>
                              {copyMessage && (
                                <p
                                  role="status"
                                  className="text-xs text-slate-500"
                                >
                                  {copyMessage}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => galleryInputRef.current?.click()}
                            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            Cambiar foto
                          </button>
                          <button
                            type="button"
                            onClick={removePhoto}
                            className="min-h-11 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50"
                          >
                            Quitar foto
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              window.open(
                                form.fotoAlbaran,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            Ver imagen completa
                          </button>
                        </div>
                      </div>
                      <p className="text-sm font-semibold leading-6 text-slate-700">
                        Revisa y completa los datos del albarán antes de guardar
                        el borrador.
                        <span className="mt-1 block text-xs font-normal text-slate-500">
                          Los campos se completan manualmente; la foto no
                          rellena datos automáticamente.
                        </span>
                      </p>
                    </>
                  )}
                  {photoError && (
                    <p
                      role="alert"
                      className="mt-2 text-sm font-medium text-red-700"
                    >
                      {photoError}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2 sm:flex sm:justify-end">
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 sm:w-auto"
                  >
                    Guardar borrador
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {view === "detail" && selectedDeCA && (
          <div className="mx-auto max-w-3xl">
            <button
              type="button"
              onClick={() => setView("list")}
              className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft size={17} /> Volver a Mis DeCAs
            </button>
            <div className="border-y border-slate-200 bg-white px-4 py-5 sm:px-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-black text-slate-900">
                    {selectedDeCA.destinatario}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(selectedDeCA.fecha)}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                  Borrador
                </span>
              </div>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                {[
                  ["Cargador", selectedDeCA.cargador],
                  ["Transportista", selectedDeCA.transportista],
                  ["Destinatario", selectedDeCA.destinatario],
                  ["Dirección de destino", selectedDeCA.direccionDestino],
                  ["Ciudad de destino", selectedDeCA.ciudadDestino],
                  ["Mercancía", selectedDeCA.mercancia],
                  ["Peso o bultos", selectedDeCA.pesoOBultos],
                  [
                    "Referencia de albarán",
                    selectedDeCA.referenciaAlbaran || "Sin referencia",
                  ],
                  ["Matrícula del vehículo", selectedDeCA.matriculaVehiculo],
                  ["Estado", "Borrador"],
                  ["Notas", selectedDeCA.notas || "Sin notas"],
                ].map(([label, value]) => (
                  <div key={label} className="border-b border-slate-100 py-3">
                    <dt className="text-xs font-bold text-slate-500">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-sm text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {selectedDeCA.fotoAlbaran && (
                <section className="mt-6 border-t border-slate-200 pt-5">
                  <h2 className="mb-3 text-sm font-bold text-slate-800">
                    Foto del albarán
                  </h2>
                  {selectedDeCA.nombreFotoAlbaran && (
                    <p className="mb-3 break-all text-xs text-slate-500">
                      {selectedDeCA.nombreFotoAlbaran}
                    </p>
                  )}
                  <img
                    src={selectedDeCA.fotoAlbaran}
                    alt={selectedDeCA.nombreFotoAlbaran || "Foto del albarán"}
                    className="max-h-96 w-full rounded-lg border border-slate-200 bg-slate-50 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        selectedDeCA.fotoAlbaran,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    Ver imagen completa
                  </button>
                </section>
              )}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-50"
                >
                  <Trash2 size={16} /> Eliminar borrador
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeCASection;
