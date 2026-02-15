
import React, { useState, useEffect } from 'react';
import { Delivery, DeliveryStatus, DeliveryType } from './types';
import { CheckCircle, Clock, MapPin, Navigation, ExternalLink, Trash2, GripVertical, ChevronDown, ChevronUp, ArrowDownLeft, ArrowUpRight, AlertTriangle, Phone, X, Tag } from 'lucide-react';

interface DeliveryCardProps {
  delivery: Delivery;
  index?: number;
  isSelected: boolean;
  forceExpanded?: boolean;
  onToggleExpand?: (expanded: boolean) => void;
  onClick: () => void;
  onStatusChange: (id: string, status: DeliveryStatus) => void;
  onDelete: (id: string) => void;
  onRemoveFromSequence: (id: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

const DeliveryCard: React.FC<DeliveryCardProps> = ({ 
  delivery, 
  index, 
  isSelected, 
  forceExpanded = false,
  onToggleExpand,
  onClick, 
  onStatusChange, 
  onDelete,
  onRemoveFromSequence,
  onDragStart,
  onDragOver,
  onDragEnd
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  
  useEffect(() => {
    if (forceExpanded) {
      setInternalExpanded(true);
    }
  }, [forceExpanded]);

  const isCompleted = delivery.status === DeliveryStatus.COMPLETED;
  const isIssue = delivery.status === DeliveryStatus.ISSUE;
  
  const getStyles = () => {
    if (isCompleted) {
      return {
        border: 'border-green-200',
        bg: 'bg-green-50/30',
        accent: 'bg-green-600',
        text: 'text-green-700',
        side: 'border-l-green-500'
      };
    }
    if (isIssue) {
      return {
        border: 'border-yellow-200',
        bg: 'bg-yellow-50/40',
        accent: 'bg-yellow-600',
        text: 'text-yellow-700',
        side: 'border-l-yellow-500'
      };
    }
    if (delivery.type === DeliveryType.PICKUP) {
      return {
        border: 'border-red-100',
        bg: 'bg-red-50/40',
        accent: 'bg-red-600',
        text: 'text-red-700',
        side: 'border-l-red-500'
      };
    }
    return {
      border: 'border-blue-100',
      bg: 'bg-blue-50/40',
      accent: 'bg-blue-600',
      text: 'text-blue-700',
      side: 'border-l-blue-500'
    };
  };

  const styles = getStyles();

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextValue = !internalExpanded;
    setInternalExpanded(nextValue);
    if (onToggleExpand) {
      onToggleExpand(nextValue);
    }
  };

  const handleClearSequence = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromSequence(delivery.id);
  };

  const currentDragIndex = typeof index === 'number' ? index : 0;

  /**
   * Validates if a string is a recognizable Google Maps URL format.
   * Supports standard domains, shortened links (goo.gl), and mobile app links (maps.app.goo.gl).
   */
  const isValidGoogleMapsUrl = (url?: string): boolean => {
    if (!url) return false;
    const googleMapsRegex = /^(https?:\/\/)?(www\.|maps\.)?(google\.com\/maps|maps\.google\.com|goo\.gl\/maps|maps\.app\.goo\.gl)/i;
    return googleMapsRegex.test(url);
  };

  // Prioritize valid sourceUrl, fallback to a standard directions link using GPS coordinates.
  const navigationUrl = isValidGoogleMapsUrl(delivery.sourceUrl)
    ? delivery.sourceUrl! 
    : `https://www.google.com/maps/dir/?api=1&destination=${delivery.coordinates[0]},${delivery.coordinates[1]}`;

  return (
    <div 
      draggable={!isCompleted && !isIssue}
      onDragStart={(e) => !isCompleted && !isIssue && onDragStart(e, currentDragIndex)}
      onDragOver={(e) => !isCompleted && !isIssue && onDragOver(e, currentDragIndex)}
      onDragEnd={onDragEnd}
      onClick={() => {
        onClick();
      }}
      className={`relative mb-3 rounded-xl border-2 border-l-[6px] transition-all cursor-pointer group shadow-sm hover:shadow-md ${
        isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''
      } ${styles.border} ${styles.bg} ${styles.side}`}
    >
      {!isCompleted && !isIssue && (
        <div className="absolute left-[-2px] top-1/2 -translate-y-1/2 text-white/80 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical size={14} />
        </div>
      )}

      <div className="pl-4 pr-3 py-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3 overflow-hidden">
            {typeof index === 'number' && index !== -1 && !isCompleted && !isIssue && (
              <div className="relative group/seq shrink-0">
                <span className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white text-[10px] font-bold rounded-full shadow-sm">
                  {index + 1}
                </span>
                <button 
                  onClick={handleClearSequence}
                  className="absolute -top-1 -right-1 bg-white text-slate-400 border border-slate-200 rounded-full p-0.5 opacity-0 group-hover/seq:opacity-100 transition-opacity shadow-sm hover:text-red-500 hover:border-red-100"
                  title="Quitar de la ruta manual"
                >
                  <X size={8} />
                </button>
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold truncate text-sm md:text-base text-slate-800 uppercase tracking-tight">
                  {delivery.concept || delivery.recipient}
                </h3>
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-tighter ${
                  isCompleted ? 'bg-green-100 text-green-600' : 
                  (isIssue ? 'bg-yellow-100 text-yellow-700' : 
                  (delivery.type === DeliveryType.PICKUP ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'))
                }`}>
                  {isIssue ? <AlertTriangle size={10} /> : (delivery.type === DeliveryType.DELIVERY ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />)}
                  {isIssue ? 'INCIDENCIA' : (delivery.type === DeliveryType.DELIVERY ? 'ENTREGA' : 'RECOGIDA')}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                <MapPin size={12} className="shrink-0" />
                <p className="truncate opacity-80">{delivery.address}</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button 
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete(delivery.id); }}
              className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-white transition-all"
            >
              <Trash2 size={16} />
            </button>
            <button 
              type="button"
              onClick={toggleExpand}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-white transition-all"
            >
              {internalExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
        </div>

        {internalExpanded && (
          <div className="mt-3 pt-3 border-t border-slate-200/50 animate-in slide-in-from-top-2 duration-200">
            <div className="space-y-4">
              {delivery.concept && (
                <div className="text-[11px] text-slate-700 bg-blue-50 border border-blue-100 p-2 rounded-lg flex items-center gap-2">
                  <Tag size={12} className="text-blue-500" />
                  <span className="font-bold uppercase tracking-tight">{delivery.recipient}</span>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-3">
                {delivery.phone ? (
                  <a 
                    href={`tel:${delivery.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-2xl text-xs font-black shadow-lg shadow-green-100 hover:bg-green-700 transition-all uppercase"
                  >
                    <Phone size={16} /> Llamar
                  </a>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-3 bg-slate-100 text-slate-400 rounded-2xl text-[10px] font-bold uppercase cursor-not-allowed">
                    Sin teléfono
                  </div>
                )}
                
                <a 
                  href={navigationUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  onClick={(e) => e.stopPropagation()} 
                  className="flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-2xl text-xs font-black shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all uppercase"
                >
                  <Navigation size={16} /> Navegar
                </a>
              </div>

              {delivery.notes && (
                <div className="bg-white/60 p-3 rounded-xl text-[11px] text-slate-600 border border-slate-100">
                  <span className="font-bold text-slate-400 uppercase text-[9px] block mb-1">Notas del Reparto:</span>
                  {delivery.notes}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 border-slate-100">
                <div className="flex flex-wrap gap-2">
                  {!isCompleted && !isIssue ? (
                    <>
                      <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onStatusChange(delivery.id, DeliveryStatus.COMPLETED); }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border-2 border-green-600 text-green-600 hover:bg-green-50 text-[10px] font-black transition-all uppercase"
                      >
                        <CheckCircle size={14} /> Entregado
                      </button>
                      <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onStatusChange(delivery.id, DeliveryStatus.ISSUE); }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border-2 border-yellow-500 text-yellow-600 hover:bg-yellow-50 text-[10px] font-black transition-all uppercase"
                      >
                        <AlertTriangle size={14} /> Incidencia
                      </button>
                    </>
                  ) : (
                    <button 
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onStatusChange(delivery.id, DeliveryStatus.PENDING); }}
                      className="text-[10px] font-black text-blue-600 hover:underline uppercase"
                    >
                      Reabrir tarea
                    </button>
                  )}
                </div>

                <div className="text-[10px] text-slate-400 flex items-center gap-1 font-black ml-auto bg-slate-50 px-3 py-1.5 rounded-lg">
                  <Clock size={12} /> {delivery.estimatedTime || '--:--'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeliveryCard;
