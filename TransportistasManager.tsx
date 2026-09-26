import React, { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { TransportistaHabitual } from "./types";
import { normalizeRecipientText } from "./destinatariosService";

type Props = {
  transportistas: TransportistaHabitual[];
  onChange: (transportistas: TransportistaHabitual[]) => void;
  onClose: () => void;
};

type TransportistaForm = Omit<
  TransportistaHabitual,
  "id" | "createdAt" | "updatedAt"
>;
type FormErrors = Partial<Record<"nombre" | "nif", string>>;

const emptyForm = (isFirst: boolean): TransportistaForm => ({
  nombre: "",
  nif: "",
  direccion: "",
  ciudad: "",
  codigoPostal: "",
  provincia: "",
  pais: "España",
  telefono: "",
  email: "",
  notas: "",
  esPredeterminado: isFirst,
});

const normalizeForm = (form: TransportistaForm): TransportistaForm => ({
  ...form,
  nombre: form.nombre.trim(),
  nif: form.nif.trim(),
  direccion: form.direccion.trim(),
  ciudad: form.ciudad.trim(),
  codigoPostal: form.codigoPostal.trim(),
  provincia: form.provincia.trim(),
  pais: form.pais.trim() || "España",
  telefono: form.telefono.trim(),
  email: form.email.trim(),
  notas: form.notas.trim(),
});

const normalizeNif = (value: string) =>
  normalizeRecipientText(value).replace(/[^a-z0-9]/g, "");

const identityKey = (
  item: Pick<TransportistaHabitual, "nombre" | "direccion" | "ciudad">,
) =>
  [item.nombre, item.direccion, item.ciudad]
    .map(normalizeRecipientText)
    .join("\u0000");

const transportistaId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const TransportistasManager: React.FC<Props> = ({
  transportistas,
  onChange,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<TransportistaHabitual | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<TransportistaForm>(() => emptyForm(false));
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState("");

  const filtered = useMemo(() => {
    const needle = normalizeRecipientText(query);
    return transportistas
      .filter(
        (item) =>
          !needle ||
          [
            item.nombre,
            item.nif,
            item.direccion,
            item.ciudad,
            item.codigoPostal,
            item.telefono,
            item.email,
          ].some((value) => normalizeRecipientText(value).includes(needle)),
      )
      .sort((left, right) =>
        left.nombre.localeCompare(right.nombre, "es", { sensitivity: "base" }),
      );
  }, [query, transportistas]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(transportistas.length === 0));
    setErrors({});
    setMessage("");
    setFormOpen(true);
  };

  const openEdit = (item: TransportistaHabitual) => {
    setEditing(item);
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...values
    } = item;
    setForm(values);
    setErrors({});
    setMessage("");
    setFormOpen(true);
  };

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeForm(form);
    const nextErrors: FormErrors = {};
    if (!normalized.nombre) nextErrors.nombre = "El nombre es obligatorio.";
    if (!normalized.nif) nextErrors.nif = "El NIF es obligatorio.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const nif = normalizeNif(normalized.nif);
    const duplicate = transportistas.find((item) => {
      if (item.id === editing?.id) return false;
      const existingNif = normalizeNif(item.nif);
      return nif && existingNif
        ? nif === existingNif
        : !nif && !existingNif && identityKey(item) === identityKey(normalized);
    });
    if (
      duplicate &&
      !window.confirm(
        `Ya existe el transportista ${duplicate.nombre} con esos datos. ¿Quieres guardarlo igualmente?`,
      )
    ) {
      return;
    }

    const now = new Date().toISOString();
    if (editing) {
      onChange(
        transportistas.map((item) => {
          if (item.id === editing.id) {
            return {
              ...normalized,
              id: item.id,
              createdAt: item.createdAt,
              updatedAt: now,
            };
          }
          return normalized.esPredeterminado && item.esPredeterminado
            ? { ...item, esPredeterminado: false, updatedAt: now }
            : item;
        }),
      );
    } else {
      const added: TransportistaHabitual = {
        ...normalized,
        id: transportistaId(),
        createdAt: now,
        updatedAt: now,
      };
      onChange([
        ...transportistas.map((item) =>
          normalized.esPredeterminado && item.esPredeterminado
            ? { ...item, esPredeterminado: false, updatedAt: now }
            : item,
        ),
        added,
      ]);
    }
    setFormOpen(false);
  };

  const markDefault = (selected: TransportistaHabitual) => {
    const now = new Date().toISOString();
    onChange(
      transportistas.map((item) => ({
        ...item,
        esPredeterminado: item.id === selected.id,
        updatedAt:
          item.esPredeterminado !== (item.id === selected.id)
            ? now
            : item.updatedAt,
      })),
    );
  };

  const deleteTransportista = (item: TransportistaHabitual) => {
    if (
      !window.confirm(
        `¿Eliminar a ${item.nombre} de transportistas habituales?`,
      )
    )
      return;
    onChange(transportistas.filter((candidate) => candidate.id !== item.id));
  };

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const fields: {
    key: Exclude<keyof TransportistaForm, "esPredeterminado">;
    label: string;
    required?: boolean;
    wide?: boolean;
  }[] = [
    { key: "nombre", label: "Nombre", required: true },
    { key: "nif", label: "NIF", required: true },
    { key: "direccion", label: "Dirección", wide: true },
    { key: "ciudad", label: "Ciudad" },
    { key: "codigoPostal", label: "Código postal" },
    { key: "provincia", label: "Provincia" },
    { key: "pais", label: "País" },
    { key: "telefono", label: "Teléfono" },
    { key: "email", label: "Email" },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-black text-slate-900">
            Transportistas habituales
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {transportistas.length} transportistas guardados
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Volver a DeCAs
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800"
          >
            <Plus size={16} /> Nuevo transportista
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
          <input
            className={`${inputClass} pl-10`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, NIF, dirección, ciudad, CP, teléfono o email"
            aria-label="Buscar transportistas habituales"
          />
        </div>
        <p className="text-sm text-slate-500">{filtered.length} resultados</p>
      </div>

      {transportistas.length === 0 ? (
        <div className="border-y border-slate-200 bg-white px-5 py-10 text-center">
          <p className="text-sm text-slate-600">
            Aún no hay transportistas habituales. Crea uno para poder elegirlo
            en tus DeCAs.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white"
          >
            Nuevo transportista
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-y border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          No hay transportistas que coincidan con la búsqueda.
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto border-y border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    "Nombre",
                    "NIF",
                    "Dirección",
                    "Ciudad",
                    "Teléfono",
                    "Estado",
                    "Acciones",
                  ].map((heading) => (
                    <th key={heading} className="px-3 py-3 font-bold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-3 font-bold text-slate-900">
                      {item.nombre}
                    </td>
                    <td className="px-3 py-3">{item.nif}</td>
                    <td className="px-3 py-3">{item.direccion}</td>
                    <td className="px-3 py-3">{item.ciudad}</td>
                    <td className="px-3 py-3">{item.telefono}</td>
                    <td className="px-3 py-3">
                      {item.esPredeterminado ? (
                        <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">
                          Predeterminado
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          aria-label={`Editar ${item.nombre}`}
                          onClick={() => openEdit(item)}
                          className="rounded p-2 text-slate-600 hover:bg-slate-100"
                        >
                          <Pencil size={16} />
                        </button>
                        {!item.esPredeterminado && (
                          <button
                            type="button"
                            onClick={() => markDefault(item)}
                            className="rounded px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50"
                          >
                            Marcar predeterminado
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Eliminar ${item.nombre}`}
                          onClick={() => deleteTransportista(item)}
                          className="rounded p-2 text-red-700 hover:bg-red-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="border-y border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-slate-900">
                      {item.nombre}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      NIF: {item.nif}
                    </p>
                    {[item.direccion, item.codigoPostal, item.ciudad]
                      .filter(Boolean)
                      .map((value, index) => (
                        <p
                          key={`${item.id}-location-${index}`}
                          className="mt-1 break-words text-sm text-slate-600"
                        >
                          {value}
                        </p>
                      ))}
                    {item.telefono && (
                      <p className="mt-1 text-sm text-slate-600">
                        {item.telefono}
                      </p>
                    )}
                    {item.esPredeterminado && (
                      <span className="mt-2 inline-block rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">
                        Predeterminado
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      aria-label={`Editar ${item.nombre}`}
                      onClick={() => openEdit(item)}
                      className="rounded p-2 text-slate-600 hover:bg-slate-100"
                    >
                      <Pencil size={17} />
                    </button>
                    {!item.esPredeterminado && (
                      <button
                        type="button"
                        aria-label={`Marcar ${item.nombre} como predeterminado`}
                        onClick={() => markDefault(item)}
                        className="rounded px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50"
                      >
                        Predeterminar
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Eliminar ${item.nombre}`}
                      onClick={() => deleteTransportista(item)}
                      className="rounded p-2 text-red-700 hover:bg-red-50"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {formOpen && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="transportista-form-title"
            className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:p-6"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2
                id="transportista-form-title"
                className="text-xl font-black text-slate-900"
              >
                {editing ? "Editar transportista" : "Nuevo transportista"}
              </h2>
              <button
                type="button"
                aria-label="Cerrar formulario de transportista"
                onClick={() => setFormOpen(false)}
                className="rounded p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map(({ key, label, required, wide }) => (
                  <div key={key} className={wide ? "sm:col-span-2" : ""}>
                    <label
                      htmlFor={`transportista-${key}`}
                      className="mb-1.5 block text-xs font-bold text-slate-600"
                    >
                      {label}
                      {required ? " *" : ""}
                    </label>
                    <input
                      id={`transportista-${key}`}
                      className={inputClass}
                      required={required}
                      type={key === "email" ? "email" : "text"}
                      value={form[key]}
                      aria-invalid={Boolean(errors[key as keyof FormErrors])}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }));
                        if (key === "nombre" || key === "nif") {
                          setErrors((current) => ({
                            ...current,
                            [key]: undefined,
                          }));
                        }
                      }}
                    />
                    {errors[key as keyof FormErrors] && (
                      <p className="mt-1 text-xs text-red-700">
                        {errors[key as keyof FormErrors]}
                      </p>
                    )}
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label
                    htmlFor="transportista-notas"
                    className="mb-1.5 block text-xs font-bold text-slate-600"
                  >
                    Notas
                  </label>
                  <textarea
                    id="transportista-notas"
                    className={`${inputClass} min-h-20 resize-y`}
                    value={form.notas}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        notas: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.esPredeterminado}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      esPredeterminado: event.target.checked,
                    }))
                  }
                />
                Marcar como predeterminado
              </label>
              {message && (
                <p role="alert" className="text-sm text-amber-800">
                  {message}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white"
                >
                  Guardar transportista
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default TransportistasManager;
