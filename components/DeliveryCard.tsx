
importar React, { useState, useEffect } de 'react';
importar { Entrega, EstadoDeEntrega, TipoDeEntrega } de '../tipos';
importar { CheckCircle, Reloj, MapPin, Navegación, Enlace externo, Papelera2, GripVertical, ChevronDown, ChevronUp, Flecha abajo izquierda, Flecha arriba derecha, AlertTriangle, Teléfono, X, Etiqueta } de 'lucide-react';

interfaz DeliveryCardProps {
  entrega: Entrega;
  índice?: número;
  isSelected: booleano;
  fuerzaExpandida?: booleano;
  onToggleExpand?: (expandido: booleano) => void;
  al hacer clic: () => vacío;
  onStatusChange: (id: cadena, estado: DeliveryStatus) => void;
  onDelete: (id: cadena) => vacío;
  onRemoveFromSequence: (id: cadena) => vacío;
  onDragStart: (e: React.DragEvent, índice: número) => void;
  onDragOver: (e: React.DragEvent, índice: número) => void;
  onDragEnd: (e: React.DragEvent) => vacío;
}

constante DeliveryCard: React.FC<DeliveryCardProps> = ({
  entrega,
  índice,
  está seleccionado,
  forceExpanded = falso,
  enToggleExpand,
  al hacer clic,
  enCambio de estado,
  al eliminar,
  al eliminar de la secuencia,
  al arrastrar y soltar,
  enDragOver,
  onDragEnd
}) => {
  const [internoExpandido, establecerInternoExpandido] = useState(falso);
  
  usarEfecto(() => {
    si (fuerzaExpandida) {
      setInternalExpanded(verdadero);
    }
  }, [fuerzaExpandida]);

  const isCompleted = entrega.estado === EstadoDeEntrega.COMPLETED;
  const isIssue = entrega.estado === EstadoDeEntrega.EMISIÓN;
  
  constante obtenerEstilos = () => {
    si (estáCompletado) {
      devolver {
        borde: 'borde-verde-200',
        bg: 'bg-verde-50/30',
        acento: 'bg-green-600',
        texto: 'texto-verde-700',
        lado: 'borde-l-verde-500'
      };
    }
    si (isIssue) {
      devolver {
        borde: 'borde-amarillo-200',
        bg: 'bg-amarillo-50/40',
        acento: 'bg-amarillo-600',
        texto: 'texto-amarillo-700',
        lado: 'borde-l-amarillo-500'
      };
    }
    si (entrega.tipo === DeliveryType.PICKUP) {
      devolver {
        borde: 'borde-rojo-100',
        bg: 'bg-rojo-50/40',
        acento: 'bg-red-600',
        texto: 'texto-rojo-700',
        lado: 'border-l-red-500'
      };
    }
    devolver {
      borde: 'borde-azul-100',
      bg: 'bg-azul-50/40',
      acento: 'bg-blue-600',
      texto: 'texto-azul-700',
      lado: 'borde-l-azul-500'
    };
  };

  const estilos = getStyles();

  constante toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    constante nextValue = !internalExpanded;
    setInternalExpanded(siguienteValor);
    si (onToggleExpand) {
      onToggleExpand(siguienteValor);
    }
  };

  constante handleClearSequence = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromSequence(entrega.id);
  };

  const currentDragIndex = tipo de índice === 'número' ? índice : 0;

  /**
   * Valida si una cadena tiene un formato de URL reconocible de Google Maps.
   * Admite dominios estándar, enlaces acortados (goo.gl) y enlaces de aplicaciones móviles (maps.app.goo.gl).
   */
  const isValidGoogleMapsUrl = (url?: cadena): booleano => {
    si (!url) devuelve falso;
    constante googleMapsRegex = /^(https?:\/\/)?(www\.|maps\.)?(google\.com\/maps|maps\.google\.com|goo\.gl\/maps|maps\.app\.goo\.gl)/i;
    devuelve googleMapsRegex.test(url);
  };

  // Priorizar una URL de origen válida y recurrir a un enlace de instrucciones estándar que utiliza coordenadas GPS.
  constante navigationUrl = isValidGoogleMapsUrl(entrega.sourceUrl)
    ? entrega.sourceUrl!
    : `https://www.google.com/maps/dir/?api=1&destination=${coordenadasdeentrega[0]},${coordenadasdeentrega[1]}`;

  devolver (
    <división
      arrastrable={!isCompleted && !isIssue}
      onDragStart={(e) => !isCompleted && !isSue && onDragStart(e, currentDragIndex)}
      onDragOver={(e) => !isCompleted && !isIssue && onDragOver(e, currentDragIndex)}
      onDragEnd={onDragEnd}
      al hacer clic={() => {
        al hacer clic();
      }}
      className={`relativo mb-3 redondeado-xl borde-2 borde-l-[6px] transición-todo cursor-puntero grupo sombra-sm hover:sombra-md ${
        ¿Está seleccionado? 'anillo-2 anillo-azul-500 anillo-desplazamiento-1' : ''
      } ${estilos.border} ${estilos.bg} ${estilos.lado}`}
    >
      {!estáCompletado && !estáEmitido && (
        <div className="izquierda absoluta-[-2px] arriba-1/2 -translate-y-1/2 texto-blanco/80 p-0.5 opacidad-0 grupo-hover:opacidad-100 opacidad-de-transición">
          <Tamaño vertical de agarre={14} />
        </div>
      )}

      <div className="pl-4 pr-3 py-3">
        <div className="justificación flexible entre elementos-inicio">
          <div className="elementos flexibles-centro gap-3 desbordamiento-oculto">
            {tipo de índice === 'número' && índice !== -1 && !isCompleted && !isIssue && (
              <div className="grupo relativo/secuencia contracción-0">
                <span className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white text-[10px] font-bold rounded-full shadow-sm">
                  {índice + 1}
                </span>
                <botón
                  onClick={manejarBorrarSecuencia}
                  className="absolute -top-1 -right-1 bg-white text-slate-400 border border-slate-200 rounded-full p-0.5 opacity-0 group-hover/seq:opacity-100 transition-opacity shadow-sm hover:text-red-500 hover:border-red-100"
                  title="Quitar de la ruta manual"
                >
                  <X tamaño={8} />
                </botón>
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold truncate text-sm md:text-base text-slate-800 uppercase tracking-tight">
                  {entrega.concepto || entrega.destinatario}
                </h3>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-tighter ${
                  ¿Está completo? 'bg-green-100 text-green-600' :
                  (¿Problema? 'bg-amarillo-100 texto-amarillo-700' :
                  (entrega.tipo === TipoDeEntrega.RECOGER ? 'bg-rojo-100 texto-rojo-600' : 'bg-azul-100 texto-azul-600'))
                }`}>
                  {isIssue ? <AlertTriangle tamaño={10} /> : (entrega.tipo === DeliveryType.ENTREGA ? <ArrowDownLeft tamaño={10} /> : <ArrowUpRight tamaño={10} />)}
                  {isProblema? 'INCIDENCIA' : (tipo.entrega === TipoEntrega.ENTREGA ? 'ENTREGA' : 'RECOGIDA')}
                </span>
              </div>
              <div className="elementos flexibles-centro espacio-1 texto-[11px] texto-pizarra-500 mt-0.5">
                <MapPin tamaño={12} className="shrink-0" />
                <p className="truncate opacity-80">{dirección de entrega}</p>
              </div>
            </div>
          </div>
          
          <div className="elementos flexibles-centro espacio-1 contracción-0 ml-2">
            <botón
              tipo="botón"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(entrega.id); }}
              className="p-1.5 redondeado-lg texto-pizarra-300 pasar el cursor:texto-rojo-500 pasar el cursor:fondo-blanco transición-todo"
            >
              <Tamaño de la papelera2={16} />
            </botón>
            <botón
              tipo="botón"
              onClick={alternarExpandir}
              className="p-1.5 redondeado-lg texto-pizarra-400 hover:bg-blanco transición-todo"
            >
              {internoExpandido ? <ChevronUp tamaño={18} /> : <ChevronDown tamaño={18} />}
            </botón>
          </div>
        </div>

        {internoExpandido && (
          <div className="mt-3 pt-3 border-t border-slate-200/50 animar-en-deslizar-desde-arriba-2 duración-200">
            <div className="espacio-y-4">
              {entrega.concepto && (
                <div className="text-[11px] text-slate-700 bg-blue-50 border border-blue-100 p-2 rounded-lg flex items-center gap-2">
                  <Tamaño de etiqueta={12} className="text-blue-500" />
                  <span className="font-bold uppercase tracking-tight">{entrega.destinatario}</span>
                </div>
              )}
              
              <div className="cuadrícula cuadrícula-columnas-2 espacio-3">
                {entrega.teléfono ? (
                  <a
                    href={`tel:${entrega.teléfono}`}
                    onClick={(e) => e.stopPropagation()}
                    className="elementos flexibles-centro justificar-centro espacio-2 py-3 fondo-verde-600 texto-blanco redondeado-2xl texto-xs fuente-negro sombra-lg sombra-verde-100 hover:fondo-verde-700 transición-todo en mayúsculas"
                  >
                    <Tamaño del teléfono={16} /> Llamar
                  </a>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-3 bg-slate-100 text-slate-400 rounded-2xl text-[10px] font-bold uppercase cursor-not-allowed">
                    Sin teléfono
                  </div>
                )}
                
                <a
                  href={URL de navegación}
                  objetivo="_en blanco"
                  rel="sin abridor ni referenciador"
                  onClick={(e) => e.stopPropagation()}
                  className="elementos flexibles-centro justificar-centro espacio-2 py-3 fondo-azul-600 texto-blanco redondeado-2xl texto-xs fuente-negro sombra-lg sombra-azul-100 hover:fondo-azul-700 transición-todo en mayúsculas"
                >
                  <Tamaño de navegación={16} /> Navegar
                </a>
              </div>

              {notas de entrega && (
                <div className="bg-white/60 p-3 rounded-xl text-[11px] text-slate-600 border border-slate-100">
                  <span className="font-bold text-slate-400 uppercase text-[9px] block mb-1">Notas del Reparto:</span>
                  {notas de entrega}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 border-slate-100">
                <div className="flex flex-wrap gap-2">
                  {!estáCompletado y!hay un problema? (
                    <>
                      <botón
                        tipo="botón"
                        onClick={(e) => { e.stopPropagation(); onStatusChange(entrega.id, EstadoDeEntrega.COMPLETO); }}
                        className="elementos flexibles-centro espacio-1.5 px-4 py-2 redondeado-xl fondo-blanco borde-2 borde-verde-600 texto-verde-600 hover:fondo-verde-50 texto-[10px] fuente-negro transición-todo en mayúsculas"
                      >
                        <CheckCircle size={14} /> Entregado
                      </botón>
                      <botón
                        tipo="botón"
                        onClick={(e) => { e.stopPropagation(); onStatusChange(entrega.id, DeliveryStatus.ISSUE); }}
                        className="elementos flexibles-centro espacio-1.5 px-4 py-2 redondeado-xl fondo-blanco borde-2 borde-amarillo-500 texto-amarillo-600 hover:fondo-amarillo-50 texto-[10px] fuente-negro transición-todo en mayúsculas"
                      >
                        <AlertTriangle size={14} /> Incidencia
                      </botón>
                    </>
                  ) : (
                    <botón
                      tipo="botón"
                      onClick={(e) => { e.stopPropagation(); onStatusChange(entrega.id, EstadoDeEntrega.PENDIENTE); }}
                      className="texto-[10px] fuente-negro texto-azul-600 pasar el cursor:subrayar mayúsculas"
                    >
                      Reabrir tarea
                    </botón>
                  )}
                </div>

                <div className="texto-[10px] texto-pizarra-400 elementos flexibles-centro espacio-1 fuente-negro ml-auto fondo-pizarra-50 px-3 py-1.5 redondeado-lg">
                  <Tamaño del reloj={12} /> {entrega.tiempoestimado || '--:--'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

exportar DeliveryCard predeterminado;
