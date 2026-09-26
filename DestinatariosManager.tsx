import React, { useMemo, useRef, useState } from "react";
import {
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { EmpresaHabitual } from "./types";
import {
  createRecipientId,
  empresasToCsv,
  empresaTemplateCsv,
  normalizeRecipientText,
  previewEmpresasCsv,
  recipientDuplicateKey,
  type CsvImportRow,
} from "./destinatariosService";

type Props = {
  recipients: EmpresaHabitual[];
  onChange: (recipients: EmpresaHabitual[]) => void;
  onClose: () => void;
  initialAction?: "create" | "import";
};

type RecipientForm = Omit<EmpresaHabitual, "id" | "createdAt" | "updatedAt">;
type FormErrors = Partial<Record<"nombre" | "direccion" | "ciudad", string>>;

const emptyForm = (): RecipientForm => ({
  nombre: "",
  direccion: "",
  ciudad: "",
  codigoPostal: "",
  provincia: "",
  pais: "España",
  nif: "",
  telefono: "",
  email: "",
  contacto: "",
  notas: "",
});

const csvFileName = () =>
  `empresas-logiroute-${new Date().toISOString().slice(0, 10)}.csv`;

const downloadText = (content: string, filename: string) => {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const normalizeForm = (form: RecipientForm) =>
  Object.fromEntries(
    Object.entries(form).map(([key, value]) => [key, value.trim()]),
  ) as RecipientForm;

const RecipientFields: React.FC<{
  form: RecipientForm;
  errors: FormErrors;
  onChange: (field: keyof RecipientForm, value: string) => void;
}> = ({ form, errors, onChange }) => {
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const fields: {
    key: keyof RecipientForm;
    label: string;
    required?: boolean;
    wide?: boolean;
  }[] = [
    { key: "nombre", label: "Nombre", required: true },
    { key: "direccion", label: "Dirección", required: true, wide: true },
    { key: "ciudad", label: "Ciudad", required: true },
    { key: "codigoPostal", label: "Código postal" },
    { key: "provincia", label: "Provincia" },
    { key: "pais", label: "País" },
    { key: "nif", label: "NIF" },
    { key: "telefono", label: "Teléfono" },
    { key: "email", label: "Email" },
    { key: "contacto", label: "Persona de contacto" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(({ key, label, required, wide }) => (
        <div key={key} className={wide ? "sm:col-span-2" : ""}>
          <label
            htmlFor={`recipient-${key}`}
            className="mb-1.5 block text-xs font-bold text-slate-600"
          >
            {label}
            {required ? " *" : ""}
          </label>
          <input
            id={`recipient-${key}`}
            className={inputClass}
            required={required}
            type={key === "email" ? "email" : "text"}
            value={form[key]}
            aria-invalid={Boolean(errors[key as keyof FormErrors])}
            onChange={(event) => onChange(key, event.target.value)}
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
          htmlFor="recipient-notas"
          className="mb-1.5 block text-xs font-bold text-slate-600"
        >
          Notas
        </label>
        <textarea
          id="recipient-notas"
          className={`${inputClass} min-h-20 resize-y`}
          value={form.notas}
          onChange={(event) => onChange("notas", event.target.value)}
        />
      </div>
    </div>
  );
};

const DestinatariosManager: React.FC<Props> = ({
  recipients,
  onChange,
  onClose,
  initialAction,
}) => {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EmpresaHabitual | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RecipientForm>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formMessage, setFormMessage] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvImportRow[] | null>(null);
  const [csvDetectedRows, setCsvDetectedRows] = useState(0);
  const [csvError, setCsvError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importPromptOpen, setImportPromptOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasOpenedAction = useRef(false);

  React.useEffect(() => {
    if (hasOpenedAction.current) return;
    hasOpenedAction.current = true;
    if (initialAction === "create") openCreate();
    if (initialAction === "import") setImportPromptOpen(true);
  }, [initialAction]);

  const filtered = useMemo(() => {
    const needle = normalizeRecipientText(query);
    return recipients
      .filter(
        (recipient) =>
          !needle ||
          [
            recipient.nombre,
            recipient.direccion,
            recipient.ciudad,
            recipient.codigoPostal,
            recipient.nif,
            recipient.telefono,
            recipient.email,
            recipient.contacto,
          ].some((value) => normalizeRecipientText(value).includes(needle)),
      )
      .sort(
        (left, right) =>
          left.nombre.localeCompare(right.nombre, "es", {
            sensitivity: "base",
          }) ||
          left.ciudad.localeCompare(right.ciudad, "es", {
            sensitivity: "base",
          }),
      );
  }, [query, recipients]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setErrors({});
    setFormMessage("");
    setFormOpen(true);
  }

  const openEdit = (recipient: EmpresaHabitual) => {
    setEditing(recipient);
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...values
    } = recipient;
    setForm(values);
    setErrors({});
    setFormMessage("");
    setFormOpen(true);
  };

  const handleFormChange = (field: keyof RecipientForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "nombre" || field === "direccion" || field === "ciudad") {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeForm(form);
    const nextErrors: FormErrors = {};
    if (!normalized.nombre) nextErrors.nombre = "El nombre es obligatorio.";
    if (!normalized.direccion)
      nextErrors.direccion = "La dirección es obligatoria.";
    if (!normalized.ciudad) nextErrors.ciudad = "La ciudad es obligatoria.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const duplicate = recipients.find(
      (recipient) =>
        recipientDuplicateKey(recipient) ===
          recipientDuplicateKey(normalized) && recipient.id !== editing?.id,
    );
    if (
      duplicate &&
      !window.confirm(
        `Ya existe una empresa con el mismo nombre, dirección y ciudad (${duplicate.nombre}). ¿Quieres guardar igualmente?`,
      )
    ) {
      return;
    }

    const now = new Date().toISOString();
    if (editing) {
      onChange(
        recipients.map((recipient) =>
          recipient.id === editing.id
            ? {
                ...normalized,
                id: editing.id,
                createdAt: editing.createdAt,
                updatedAt: now,
              }
            : recipient,
        ),
      );
    } else {
      onChange([
        {
          ...normalized,
          id: createRecipientId(),
          createdAt: now,
          updatedAt: now,
        },
        ...recipients,
      ]);
    }
    setFormOpen(false);
  };

  const handleDelete = (recipient: EmpresaHabitual) => {
    if (
      !window.confirm(`¿Eliminar a ${recipient.nombre} de Empresas habituales?`)
    )
      return;
    onChange(recipients.filter((item) => item.id !== recipient.id));
  };

  const handleCsvFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setImportMessage("");
    if (!file) return;
    try {
      const result = previewEmpresasCsv(await file.text(), recipients);
      setCsvPreview(result.rows);
      setCsvDetectedRows(result.detectedRows);
      setCsvError(result.headerError ?? "");
      setImportPromptOpen(false);
    } catch {
      setCsvPreview([]);
      setCsvDetectedRows(0);
      setCsvError("No se pudo leer el archivo CSV.");
      setImportPromptOpen(false);
    }
  };

  const confirmImport = () => {
    if (!csvPreview || csvError) return;
    const toImport = csvPreview.flatMap((row) =>
      row.empresa && !row.reason ? [row.empresa] : [],
    );
    onChange([...toImport, ...recipients]);
    const omitted = csvDetectedRows - toImport.length;
    setImportMessage(
      `Importadas ${toImport.length} empresas; omitidas ${omitted}.`,
    );
    setCsvPreview(null);
    setCsvDetectedRows(0);
  };

  const validRows =
    csvPreview?.filter((row) => row.empresa && !row.reason).length ?? 0;
  const omittedRows =
    csvPreview?.filter((row) => row.reason && !row.duplicate).length ?? 0;
  const duplicateRows = csvPreview?.filter((row) => row.duplicate).length ?? 0;
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-black text-slate-900">
            Empresas habituales
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {recipients.length} empresas guardadas
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
            <Plus size={16} /> Nueva empresa
          </button>
          <button
            type="button"
            aria-label="Importar CSV"
            title="Importar CSV"
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <Upload size={16} /> Importar CSV
          </button>
          <button
            type="button"
            aria-label="Descargar plantilla CSV"
            title="Descargar plantilla CSV"
            onClick={() =>
              downloadText(
                empresaTemplateCsv(),
                "plantilla-empresas-logiroute.csv",
              )
            }
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <Download size={16} /> Plantilla CSV
          </button>
          <button
            type="button"
            aria-label="Exportar todas las empresas a CSV"
            title="Exportar CSV"
            onClick={() =>
              downloadText(empresasToCsv(recipients), csvFileName())
            }
            disabled={!recipients.length}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept=".csv,text/csv"
        aria-label="Seleccionar archivo CSV de empresas"
        onChange={handleCsvFile}
      />
      {importMessage && (
        <p
          role="status"
          className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {importMessage}
        </p>
      )}
      {importPromptOpen && (
        <section className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-bold text-slate-800">
            Selecciona el CSV de empresas para previsualizarlo.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white"
            >
              Seleccionar archivo CSV
            </button>
            <button
              type="button"
              onClick={() => setImportPromptOpen(false)}
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
            >
              Cancelar
            </button>
          </div>
        </section>
      )}
      {csvPreview && (
        <section className="mb-5 space-y-3 rounded-lg border border-blue-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">
                Previsualización de importación
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Filas detectadas: {csvDetectedRows} · válidas: {validRows} ·
                omitidas: {omittedRows} · posibles duplicados: {duplicateRows}
              </p>
            </div>
            <button
              type="button"
              aria-label="Cancelar importación CSV"
              onClick={() => {
                setCsvPreview(null);
                setCsvError("");
              }}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>
          {csvError && (
            <p role="alert" className="text-sm text-red-700">
              {csvError}
            </p>
          )}
          {csvPreview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-xs">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="p-2">Fila</th>
                    <th className="p-2">Nombre</th>
                    <th className="p-2">Dirección</th>
                    <th className="p-2">Ciudad</th>
                    <th className="p-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.slice(0, 10).map((row) => (
                    <tr key={row.rowNumber} className="border-b">
                      <td className="p-2">{row.rowNumber}</td>
                      <td className="p-2">{row.empresa?.nombre ?? "—"}</td>
                      <td className="p-2">{row.empresa?.direccion ?? "—"}</td>
                      <td className="p-2">{row.empresa?.ciudad ?? "—"}</td>
                      <td className="p-2">
                        {row.duplicate ? "Duplicado" : (row.reason ?? "Válida")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCsvPreview(null);
                setCsvError("");
              }}
              className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmImport}
              disabled={Boolean(csvError) || validRows === 0}
              className="min-h-10 rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Confirmar importación
            </button>
          </div>
        </section>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
          <input
            className={`${inputClass} pl-10 pr-10`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, dirección, ciudad, CP, NIF, teléfono, email o contacto"
            aria-label="Buscar empresas habituales"
          />
          {query && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <p className="text-sm text-slate-500">{filtered.length} resultados</p>
      </div>

      {recipients.length === 0 ? (
        <div className="border-y border-slate-200 bg-white px-5 py-10 text-center">
          <p className="text-sm text-slate-600">
            Aún no hay empresas guardadas. Crea una o importa un CSV.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white"
            >
              Crear empresa
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
            >
              Importar CSV
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border-y border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          No hay empresas que coincidan con la búsqueda.
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto border-y border-slate-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    "Nombre",
                    "Dirección",
                    "Ciudad",
                    "Código postal",
                    "Teléfono",
                    "Persona de contacto",
                    "NIF",
                    "Acciones",
                  ].map((heading) => (
                    <th key={heading} className="px-3 py-3 font-bold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((recipient) => (
                  <tr key={recipient.id}>
                    <td className="px-3 py-3 font-bold text-slate-900">
                      {recipient.nombre}
                    </td>
                    <td className="px-3 py-3">{recipient.direccion}</td>
                    <td className="px-3 py-3">{recipient.ciudad}</td>
                    <td className="px-3 py-3">{recipient.codigoPostal}</td>
                    <td className="px-3 py-3">{recipient.telefono}</td>
                    <td className="px-3 py-3">{recipient.contacto}</td>
                    <td className="px-3 py-3">{recipient.nif}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-label={`Editar ${recipient.nombre}`}
                          onClick={() => openEdit(recipient)}
                          className="rounded p-2 text-slate-600 hover:bg-slate-100"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar ${recipient.nombre}`}
                          onClick={() => handleDelete(recipient)}
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
            {filtered.map((recipient) => (
              <article
                key={recipient.id}
                className="border-y border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-slate-900">
                      {recipient.nombre}
                    </h2>
                    <p className="mt-1 break-words text-sm text-slate-600">
                      {recipient.direccion}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {[recipient.codigoPostal, recipient.ciudad]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                    {recipient.telefono && (
                      <p className="mt-1 text-sm text-slate-600">
                        {recipient.telefono}
                      </p>
                    )}
                    {recipient.contacto && (
                      <p className="mt-1 text-sm text-slate-600">
                        Contacto: {recipient.contacto}
                      </p>
                    )}
                    {recipient.nif && (
                      <p className="mt-1 text-sm text-slate-600">
                        NIF: {recipient.nif}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0">
                    <button
                      type="button"
                      aria-label={`Editar ${recipient.nombre}`}
                      onClick={() => openEdit(recipient)}
                      className="rounded p-2 text-slate-600 hover:bg-slate-100"
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar ${recipient.nombre}`}
                      onClick={() => handleDelete(recipient)}
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
            aria-labelledby="recipient-form-title"
            className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:p-6"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2
                id="recipient-form-title"
                className="text-xl font-black text-slate-900"
              >
                {editing ? "Editar empresa" : "Nueva empresa"}
              </h2>
              <button
                type="button"
                aria-label="Cerrar formulario"
                onClick={() => setFormOpen(false)}
                className="rounded p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            {formMessage && (
              <p role="alert" className="mb-3 text-sm text-amber-800">
                {formMessage}
              </p>
            )}
            <form onSubmit={handleSave} className="space-y-4">
              <RecipientFields
                form={form}
                errors={errors}
                onChange={handleFormChange}
              />
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
                  Guardar empresa
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default DestinatariosManager;
