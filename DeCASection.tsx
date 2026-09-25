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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decas));
    } catch {
      // La sección sigue siendo utilizable aunque el navegador no permita persistir.
    }
  }, [decas]);

  const selectedDeCA = decas.find((deca) => deca.id === selectedId);

  const updateField = (field: keyof DeCAForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

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
                  {form.fotoAlbaran ? (
                    <div className="space-y-3">
                      <img
                        src={form.fotoAlbaran}
                        alt="Vista previa del albarán"
                        className="max-h-64 w-full rounded-lg border border-slate-200 bg-slate-50 object-contain sm:w-auto sm:max-w-full"
                      />
                      {form.nombreFotoAlbaran && (
                        <p className="break-all text-xs text-slate-500">
                          {form.nombreFotoAlbaran}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                        >
                          Cambiar foto
                        </button>
                        <button
                          type="button"
                          onClick={removePhoto}
                          className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50"
                        >
                          Quitar foto
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <FileText size={16} /> Hacer foto
                      </button>
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <Upload size={16} /> Elegir foto
                      </button>
                    </div>
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
