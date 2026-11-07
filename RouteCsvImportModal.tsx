// RouteCsvImportModal.tsx
// Modal de previsualización e importación CSV para Rutas.
// No crea DeCAs ni documentos. Solo construye paradas Delivery.

import React, { useRef, useState } from "react";
import { X, Upload, FileText, AlertTriangle, CheckCircle } from "lucide-react";
import { DeliveryType } from "./types";
import {
  previewRoutesCsv,
  routeTemplateCsv,
  type RouteCsvPreview,
  type RouteCsvRow,
} from "./routeCsvService";

interface Props {
  onClose: () => void;
  onImport: (
    rows: Extract<RouteCsvRow, { kind: "valid" }>[],
  ) => void | Promise<void>;
  disabled?: boolean;
}

export const RouteCsvImportModal: React.FC<Props> = ({
  onClose,
  onImport,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<RouteCsvPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importingRef = useRef(false);

  const validRows = preview
    ? (preview.rows.filter((r) => r.kind === "valid") as Extract<
        RouteCsvRow,
        { kind: "valid" }
      >[])
    : [];
  const errorRows = preview
    ? (preview.rows.filter((r) => r.kind === "error") as Extract<
        RouteCsvRow,
        { kind: "error" }
      >[])
    : [];

  const handleFile = (file: File) => {
    setFileName(file.name);
    setPreview(null);
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setPreview(previewRoutesCsv(content));
    };
    reader.readAsText(file, "utf-8");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleImportConfirm = async () => {
    if (validRows.length === 0 || importingRef.current || disabled) return;
    importingRef.current = true;
    setImporting(true);
    setImportError(null);
    try {
      await onImport(validRows);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "No se pudieron importar las paradas.",
      );
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([routeTemplateCsv()], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_paradas.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xl z-[110] flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] w-full max-w-lg max-h-[90vh] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b flex justify-between items-center bg-slate-50/60 shrink-0">
          <h3 className="text-xl font-black uppercase tracking-tighter italic">
            Importar paradas CSV
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="p-2 hover:bg-slate-200 rounded-xl disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition"
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
          >
            <Upload className="mx-auto mb-2 text-slate-400" size={28} />
            <p className="text-sm font-semibold text-slate-600">
              {fileName ? (
                <>
                  <FileText className="inline mr-1" size={14} />
                  {fileName}
                </>
              ) : (
                "Arrastra un CSV o haz clic para seleccionarlo"
              )}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Mismo formato que DeCAs · separador ; o ,
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>

          {/* Template download */}
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="text-xs text-blue-600 underline hover:text-blue-800"
          >
            Descargar plantilla CSV
          </button>

          {/* Header error */}
          {preview?.headerError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{preview.headerError}</span>
            </div>
          )}

          {importError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{importError}</span>
            </div>
          )}

          {/* Summary */}
          {preview && !preview.headerError && (
            <div className="text-sm text-slate-600 space-y-1">
              <p>
                <span className="font-semibold text-emerald-700">
                  {validRows.length}
                </span>{" "}
                paradas válidas ·{" "}
                <span
                  className={
                    errorRows.length > 0 ? "font-semibold text-red-600" : ""
                  }
                >
                  {errorRows.length} con error
                </span>
              </p>
            </div>
          )}

          {/* Valid rows preview */}
          {validRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase text-slate-400">
                Paradas a importar
              </p>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {validRows.map((r) => (
                  <li
                    key={r.delivery.id}
                    className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 text-xs"
                  >
                    <CheckCircle
                      size={12}
                      className="shrink-0 mt-0.5 text-emerald-500"
                    />
                    <span>
                      <span className="text-slate-400 mr-1">
                        F{r.rowNumber}
                      </span>
                      <span className="font-semibold">
                        {r.delivery.recipient}
                      </span>
                      {r.delivery.address && (
                        <span className="text-slate-500">
                          {" "}
                          · {r.delivery.address}
                        </span>
                      )}
                      {r.delivery.concept && (
                        <span className="text-slate-400">
                          {" "}
                          · Ref. / concepto: {r.delivery.concept}
                        </span>
                      )}
                      {r.delivery.phone && (
                        <span className="text-slate-500">
                          {" "}
                          · Tel. {r.delivery.phone}
                        </span>
                      )}
                      <span
                        className={`ml-1 px-1 rounded text-[10px] font-black uppercase ${
                          r.delivery.type === DeliveryType.PICKUP
                            ? "bg-amber-100 text-amber-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {r.delivery.type === DeliveryType.PICKUP
                          ? "Recogida"
                          : "Entrega"}
                      </span>
                      {r.delivery.pesoKg != null && (
                        <span className="text-slate-400 ml-1">
                          {r.delivery.pesoKg} kg
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Error rows */}
          {errorRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase text-red-500">
                Filas con error (no se importarán)
              </p>
              <ul className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {errorRows.map((r) => (
                  <li
                    key={r.rowNumber}
                    className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs"
                  >
                    <AlertTriangle
                      size={12}
                      className="shrink-0 mt-0.5 text-red-500"
                    />
                    <span>
                      <span className="font-semibold text-slate-500 mr-1">
                        Fila {r.rowNumber}:
                      </span>
                      {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t bg-slate-50/60 flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleImportConfirm}
            disabled={validRows.length === 0 || importing || disabled}
            className="px-5 py-2 rounded-xl text-sm font-black uppercase bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 flex items-center gap-2"
          >
            {importing ? (
              "Geocodificando e importando…"
            ) : (
              <>
                <Upload size={14} />
                Importar {validRows.length > 0 ? `${validRows.length} paradas` : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
