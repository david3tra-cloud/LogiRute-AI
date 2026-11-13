export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      deca_versions: {
        Row: {
          created_at: string
          deca_id: string
          id: string
          pdf_path: string
          pdf_public_url: string
          version: number
        }
        Insert: {
          created_at?: string
          deca_id: string
          id?: string
          pdf_path: string
          pdf_public_url: string
          version: number
        }
        Update: {
          created_at?: string
          deca_id?: string
          id?: string
          pdf_path?: string
          pdf_public_url?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "deca_versions_deca_id_fkey"
            columns: ["deca_id"]
            isOneToOne: false
            referencedRelation: "decas"
            referencedColumns: ["id"]
          },
        ]
      }
      decas: {
        Row: {
          bultos: number | null
          cargador: string | null
          cargador_nif: string | null
          created_at: string
          destinatario: string | null
          destinatario_nif: string | null
          destinatario_codigo_postal: string | null
          destinatario_pais: string | null
          destino: string | null
          emitted_at: string | null
          emission_error: string | null
          empresa_habitual_id: string | null
          estado: string
          id: string
          matricula: string | null
          mercancia: string | null
          observaciones: string | null
          origen: string | null
          peso_bruto: number | null
          transportista: string | null
          transportista_habitual_id: string | null
          transportista_nif: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bultos?: number | null
          cargador?: string | null
          cargador_nif?: string | null
          created_at?: string
          destinatario?: string | null
          destinatario_nif?: string | null
          destinatario_codigo_postal?: string | null
          destinatario_pais?: string | null
          destino?: string | null
          emitted_at?: string | null
          emission_error?: string | null
          empresa_habitual_id?: string | null
          estado?: string
          id?: string
          matricula?: string | null
          mercancia?: string | null
          observaciones?: string | null
          origen?: string | null
          peso_bruto?: number | null
          transportista?: string | null
          transportista_habitual_id?: string | null
          transportista_nif?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bultos?: number | null
          cargador?: string | null
          cargador_nif?: string | null
          created_at?: string
          destinatario?: string | null
          destinatario_nif?: string | null
          destinatario_codigo_postal?: string | null
          destinatario_pais?: string | null
          destino?: string | null
          emitted_at?: string | null
          emission_error?: string | null
          empresa_habitual_id?: string | null
          estado?: string
          id?: string
          matricula?: string | null
          mercancia?: string | null
          observaciones?: string | null
          origen?: string | null
          peso_bruto?: number | null
          transportista?: string | null
          transportista_habitual_id?: string | null
          transportista_nif?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decas_empresa_habitual_id_fkey"
            columns: ["empresa_habitual_id"]
            isOneToOne: false
            referencedRelation: "empresas_habituales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decas_transportista_habitual_owner_fkey"
            columns: ["user_id", "transportista_habitual_id"]
            isOneToOne: false
            referencedRelation: "transportistas_habituales"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "decas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas_habituales: {
        Row: {
          ciudad: string | null
          codigo_postal: string | null
          contacto: string | null
          created_at: string
          direccion: string | null
          email: string | null
          id: string
          nif: string | null
          nombre: string
          notas: string | null
          pais: string | null
          provincia: string | null
          telefono: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ciudad?: string | null
          codigo_postal?: string | null
          contacto?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          nif?: string | null
          nombre: string
          notas?: string | null
          pais?: string | null
          provincia?: string | null
          telefono?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ciudad?: string | null
          codigo_postal?: string | null
          contacto?: string | null
          created_at?: string
          direccion?: string | null
          email?: string | null
          id?: string
          nif?: string | null
          nombre?: string
          notas?: string | null
          pais?: string | null
          provincia?: string | null
          telefono?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          birth_year: number | null
          created_at: string
          display_name: string | null
          equipment: string[] | null
          full_name: string | null
          goal: string | null
          height_cm: number | null
          id: string
          level: string | null
          limitations: string | null
          measurements: Json | null
          plan: string | null
          preferred_style: string | null
          session_minutes: number | null
          sex: string | null
          training_days_per_week: number | null
          updated_at: string | null
          weight_kg: number | null
        }
        Insert: {
          birth_year?: number | null
          created_at?: string
          display_name?: string | null
          equipment?: string[] | null
          full_name?: string | null
          goal?: string | null
          height_cm?: number | null
          id?: string
          level?: string | null
          limitations?: string | null
          measurements?: Json | null
          plan?: string | null
          preferred_style?: string | null
          session_minutes?: number | null
          sex?: string | null
          training_days_per_week?: number | null
          updated_at?: string | null
          weight_kg?: number | null
        }
        Update: {
          birth_year?: number | null
          created_at?: string
          display_name?: string | null
          equipment?: string[] | null
          full_name?: string | null
          goal?: string | null
          height_cm?: number | null
          id?: string
          level?: string | null
          limitations?: string | null
          measurements?: Json | null
          plan?: string | null
          preferred_style?: string | null
          session_minutes?: number | null
          sex?: string | null
          training_days_per_week?: number | null
          updated_at?: string | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      routines: {
        Row: {
          created_at: string
          data: Json
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          description?: string | null
          id: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transportistas_habituales: {
        Row: {
          ciudad: string
          codigo_postal: string
          created_at: string
          deleted_at: string | null
          direccion: string
          email: string
          es_predeterminado: boolean
          id: string
          legacy_id: string | null
          nif: string
          nombre: string
          notas: string
          pais: string
          provincia: string
          telefono: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ciudad?: string
          codigo_postal?: string
          created_at?: string
          deleted_at?: string | null
          direccion?: string
          email?: string
          es_predeterminado?: boolean
          id?: string
          legacy_id?: string | null
          nif: string
          nombre: string
          notas?: string
          pais?: string
          provincia?: string
          telefono?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ciudad?: string
          codigo_postal?: string
          created_at?: string
          deleted_at?: string | null
          direccion?: string
          email?: string
          es_predeterminado?: boolean
          id?: string
          legacy_id?: string | null
          nif?: string
          nombre?: string
          notas?: string
          pais?: string
          provincia?: string
          telefono?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      weight_records: {
        Row: {
          date: string
          id: string
          user_id: string
          weight: number
        }
        Insert: {
          date?: string
          id: string
          user_id: string
          weight: number
        }
        Update: {
          date?: string
          id?: string
          user_id?: string
          weight?: number
        }
        Relationships: []
      }
      workouts: {
        Row: {
          created_at: string
          data: Json
          date: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          date?: string
          id: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          date?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
