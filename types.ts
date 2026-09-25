export enum DeliveryStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  ISSUE = "ISSUE",
}

export enum DeliveryType {
  DELIVERY = "DELIVERY",
  PICKUP = "PICKUP",
}

export interface Location {
  lat: number;
  lng: number;
  address: string;
}

export interface Delivery {
  id: string;
  concept?: string; // New field for short stop name
  recipient: string;
  address: string;
  phone?: string;
  coordinates: [number, number]; // [lat, lng]
  status: DeliveryStatus;
  type: DeliveryType;
  notes?: string;
  estimatedTime?: string;
  sourceUrl?: string;
}

export interface RouteStats {
  totalDistance: number;
  totalTime: number;
  completedStops: number;
  totalStops: number;
}

export interface DeCA {
  id: string;
  fecha: string;
  cargador: string;
  transportista: string;
  destinatario: string;
  direccionDestino: string;
  ciudadDestino: string;
  mercancia: string;
  pesoOBultos: string;
  referenciaAlbaran: string;
  matriculaVehiculo: string;
  notas: string;
  estado: "borrador";
  createdAt: string;
  updatedAt: string;
  fotoAlbaran?: string;
  nombreFotoAlbaran?: string;
}
