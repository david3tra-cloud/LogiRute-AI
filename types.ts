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

export interface EmpresaHabitual {
  id: string;
  nombre: string;
  direccion: string;
  ciudad: string;
  codigoPostal: string;
  provincia: string;
  pais: string;
  nif: string;
  telefono: string;
  email: string;
  contacto: string;
  notas: string;
  createdAt: string;
  updatedAt: string;
}

export type Destinatario = EmpresaHabitual;

export interface MatriculaHabitual {
  id: string;
  valor: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransportistaHabitual {
  id: string;
  nombre: string;
  nif: string;
  direccion: string;
  ciudad: string;
  codigoPostal: string;
  provincia: string;
  pais: string;
  telefono: string;
  email: string;
  notas: string;
  esPredeterminado: boolean;
  createdAt: string;
  updatedAt: string;
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
  numeroBultos?: string;
  pesoKg?: string;
  pesoOBultos?: string;
  referenciaAlbaran: string;
  matriculaVehiculo: string;
  notas: string;
  estado: "borrador";
  createdAt: string;
  updatedAt: string;
  fotoAlbaran?: string;
  nombreFotoAlbaran?: string;
  transportistaNif?: string;
  transportistaDireccion?: string;
  transportistaCiudad?: string;
  transportistaCodigoPostal?: string;
  transportistaProvincia?: string;
  transportistaPais?: string;
  transportistaTelefono?: string;
  transportistaEmail?: string;
  transportistaNotas?: string;
}
