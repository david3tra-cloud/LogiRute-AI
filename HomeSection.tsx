import { ArrowUpRight, Download, FileText, Map, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppModule } from "./navigationHistory";

type HomeSectionProps = {
  onNavigate: (module: AppModule) => void;
  showInstallPrompt: boolean;
  isSafariIos: boolean;
  installError: string | null;
  isInstallPromptDeclined: boolean;
  hasDeferredInstallPrompt: boolean;
  isInstallPrompting: boolean;
  onInstall: () => void;
  onDismissInstallPrompt: () => void;
};

const accessCards: {
  id: Exclude<AppModule, "home">;
  title: string;
  description: string;
  icon: LucideIcon;
  surface: string;
  iconSurface: string;
  accent: string;
  focusRing: string;
}[] = [
  {
    id: "routes",
    title: "Rutas",
    description: "Planifica y controla las paradas de la jornada.",
    icon: Map,
    surface:
      "border-blue-200 bg-gradient-to-br from-blue-50 via-white to-cyan-50",
    iconSurface: "bg-blue-700 text-white",
    accent: "bg-blue-500",
    focusRing: "focus-visible:ring-blue-500",
  },
  {
    id: "decas",
    title: "DeCAs",
    description: "Crea, importa, emite y consulta documentos de transporte.",
    icon: FileText,
    surface:
      "border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50",
    iconSurface: "bg-indigo-700 text-white",
    accent: "bg-indigo-500",
    focusRing: "focus-visible:ring-indigo-500",
  },
  {
    id: "billing",
    title: "Facturación",
    description: "Gestiona la facturación y documentación económica.",
    icon: Receipt,
    surface:
      "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50",
    iconSurface: "bg-emerald-700 text-white",
    accent: "bg-emerald-500",
    focusRing: "focus-visible:ring-emerald-500",
  },
];

export default function HomeSection({
  onNavigate,
  showInstallPrompt,
  isSafariIos,
  installError,
  isInstallPromptDeclined,
  hasDeferredInstallPrompt,
  isInstallPrompting,
  onInstall,
  onDismissInstallPrompt,
}: HomeSectionProps) {
  return (
    <main className="min-h-full bg-gradient-to-br from-slate-100 via-slate-50 to-blue-100/70 px-4 py-4 sm:px-8 sm:py-6">
      <div className="mx-auto w-full max-w-6xl">
        <section className="relative isolate overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-blue-950 to-blue-900 px-5 py-5 text-white shadow-lg sm:px-7 sm:py-6">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-300 to-blue-500"
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-cyan-400/15 to-transparent"
          />
          <div className="relative flex items-center gap-4">
            <img
              src="/icons/icon_192x192.png"
              alt=""
              className="h-12 w-12 shrink-0 rounded-2xl border border-white/30 bg-white shadow-md sm:h-14 sm:w-14"
            />
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
                LOGIROUTE AI
              </p>
              <h1 className="text-xl font-black tracking-tight sm:text-2xl">
                Bienvenido a LogiRute
              </h1>
              <p className="mt-1 text-xs text-blue-100 sm:text-sm">
                Selecciona el área desde la que quieres trabajar.
              </p>
            </div>
          </div>
        </section>

        {showInstallPrompt && (
          <aside
            aria-labelledby="pwa-install-title"
            className="mt-4 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-gradient-to-r from-white to-blue-50 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white shadow-sm">
                <Download size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2
                  id="pwa-install-title"
                  className="text-sm font-black text-slate-900"
                >
                  Instala LogiRute
                </h2>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">
                  {isSafariIos
                    ? "Para instalarla, pulsa Compartir en Safari y selecciona “Añadir a pantalla de inicio”."
                    : installError ??
                      (isInstallPromptDeclined
                        ? "Has pospuesto la instalación. Puedes instalar LogiRute desde el menú del navegador."
                        : null) ??
                      "Accede más rápido desde el escritorio o la pantalla de inicio."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {hasDeferredInstallPrompt && (
                <button
                  type="button"
                  onClick={onInstall}
                  disabled={isInstallPrompting}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:cursor-wait disabled:opacity-60"
                >
                  {isInstallPrompting
                    ? "Abriendo instalación..."
                    : "Instalar LogiRute"}
                </button>
              )}
              <button
                type="button"
                onClick={onDismissInstallPrompt}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-300"
              >
                Ahora no
              </button>
            </div>
          </aside>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accessCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className={`group relative flex min-h-36 items-center gap-4 overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 ${card.surface} ${card.focusRing}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1 ${card.accent}`}
                />
                <span
                  aria-hidden="true"
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-sm ${card.iconSurface}`}
                >
                  <Icon size={22} strokeWidth={2.2} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-black text-slate-900 sm:text-lg">
                    {card.title}
                  </span>
                  <span className="mt-1 text-sm leading-snug text-slate-600">
                    {card.description}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-extrabold text-slate-700 transition group-hover:text-slate-950">
                    Abrir área
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
