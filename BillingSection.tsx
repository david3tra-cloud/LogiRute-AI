import React from "react";

const BillingSection: React.FC = () => (
  <div className="min-h-full bg-slate-50 px-4 py-6 sm:px-8 sm:py-8">
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-black text-slate-900">Facturación</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
        Próximamente podrás revisar facturas diarias y rectificaciones recibidas
        por correo.
      </p>
      <div className="mt-6 grid divide-y divide-slate-200 border-y border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {["Facturas diarias", "Rectificaciones", "Resumen mensual"].map(
          (item) => (
            <div key={item} className="px-5 py-5">
              <h2 className="text-sm font-bold text-slate-800">{item}</h2>
              <p className="mt-2 text-xs font-semibold text-slate-400">
                Próximamente
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  </div>
);

export default BillingSection;
