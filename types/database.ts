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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          outcome: Database["public"]["Enums"]["audit_outcome"]
          reason: string | null
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          outcome?: Database["public"]["Enums"]["audit_outcome"]
          reason?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          outcome?: Database["public"]["Enums"]["audit_outcome"]
          reason?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      auth_identities: {
        Row: {
          created_at: string
          id: string
          is_temporary_password: boolean
          last_password_change_at: string | null
          password_hash: string | null
          password_history: string[]
          provider: Database["public"]["Enums"]["auth_provider"]
          provider_subject: string | null
          temporary_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_temporary_password?: boolean
          last_password_change_at?: string | null
          password_hash?: string | null
          password_history?: string[]
          provider: Database["public"]["Enums"]["auth_provider"]
          provider_subject?: string | null
          temporary_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_temporary_password?: boolean
          last_password_change_at?: string | null
          password_hash?: string | null
          password_history?: string[]
          provider?: Database["public"]["Enums"]["auth_provider"]
          provider_subject?: string | null
          temporary_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      break_glass: {
        Row: {
          credential_hash: string
          generated_at: string
          generated_by_id: string | null
          id: string
          invalidated_at: string | null
          notes: string | null
          used_at: string | null
          used_from_ip: unknown
        }
        Insert: {
          credential_hash: string
          generated_at?: string
          generated_by_id?: string | null
          id?: string
          invalidated_at?: string | null
          notes?: string | null
          used_at?: string | null
          used_from_ip?: unknown
        }
        Update: {
          credential_hash?: string
          generated_at?: string
          generated_by_id?: string | null
          id?: string
          invalidated_at?: string | null
          notes?: string | null
          used_at?: string | null
          used_from_ip?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "break_glass_generated_by_id_fkey"
            columns: ["generated_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_glass_generated_by_id_fkey"
            columns: ["generated_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          attempt_count: number
          consumed_at: string | null
          created_at: string
          created_by_id: string | null
          email_attempted_at: string | null
          email_detail: string | null
          email_sandbox: boolean | null
          email_state: string | null
          expires_at: string
          id: string
          invalidated_at: string | null
          link_opened_at: string | null
          purpose: Database["public"]["Enums"]["invitation_purpose"]
          sent_to_email: string
          token_hash: string
          trail_ref: string | null
          user_id: string
        }
        Insert: {
          attempt_count?: number
          consumed_at?: string | null
          created_at?: string
          created_by_id?: string | null
          email_attempted_at?: string | null
          email_detail?: string | null
          email_sandbox?: boolean | null
          email_state?: string | null
          expires_at: string
          id?: string
          invalidated_at?: string | null
          link_opened_at?: string | null
          purpose: Database["public"]["Enums"]["invitation_purpose"]
          sent_to_email: string
          token_hash: string
          trail_ref?: string | null
          user_id: string
        }
        Update: {
          attempt_count?: number
          consumed_at?: string | null
          created_at?: string
          created_by_id?: string | null
          email_attempted_at?: string | null
          email_detail?: string | null
          email_sandbox?: boolean | null
          email_state?: string | null
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          link_opened_at?: string | null
          purpose?: Database["public"]["Enums"]["invitation_purpose"]
          sent_to_email?: string
          token_hash?: string
          trail_ref?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          created_at: string
          email_attempted: string
          id: string
          ip_address: unknown
          ip_country: string | null
          outcome: Database["public"]["Enums"]["login_outcome"]
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email_attempted: string
          id?: string
          ip_address?: unknown
          ip_country?: string | null
          outcome: Database["public"]["Enums"]["login_outcome"]
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email_attempted?: string
          id?: string
          ip_address?: unknown
          ip_country?: string | null
          outcome?: Database["public"]["Enums"]["login_outcome"]
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      mfa_factors: {
        Row: {
          created_at: string
          credential_id: string | null
          friendly_name: string
          id: string
          is_primary: boolean
          last_used_at: string | null
          public_key: string | null
          secret_encrypted: string | null
          sign_count: number
          type: Database["public"]["Enums"]["mfa_type"]
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          credential_id?: string | null
          friendly_name: string
          id?: string
          is_primary?: boolean
          last_used_at?: string | null
          public_key?: string | null
          secret_encrypted?: string | null
          sign_count?: number
          type: Database["public"]["Enums"]["mfa_type"]
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          credential_id?: string | null
          friendly_name?: string
          id?: string
          is_primary?: boolean
          last_used_at?: string | null
          public_key?: string | null
          secret_encrypted?: string | null
          sign_count?: number
          type?: Database["public"]["Enums"]["mfa_type"]
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mfa_factors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mfa_factors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          created_at: string
          details: Json
          event_type: string
          id: string
          ip_address: unknown
          ip_country: string | null
          severity: Database["public"]["Enums"]["security_severity"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          ip_address?: unknown
          ip_country?: string | null
          severity?: Database["public"]["Enums"]["security_severity"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          ip_address?: unknown
          ip_country?: string | null
          severity?: Database["public"]["Enums"]["security_severity"]
          user_id?: string | null
        }
        Relationships: []
      }
      sessions: {
        Row: {
          absolute_expires_at: string
          created_at: string
          device_fingerprint: string
          expires_at: string
          id: string
          ip_address: unknown
          ip_asn: string | null
          ip_country: string | null
          last_seen_at: string
          refresh_token_hash: string
          reuse_detected_at: string | null
          revoked_at: string | null
          revoked_reason: string | null
          rotated_from_id: string | null
          step_up_verified_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          absolute_expires_at: string
          created_at?: string
          device_fingerprint: string
          expires_at: string
          id?: string
          ip_address?: unknown
          ip_asn?: string | null
          ip_country?: string | null
          last_seen_at?: string
          refresh_token_hash: string
          reuse_detected_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_from_id?: string | null
          step_up_verified_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          absolute_expires_at?: string
          created_at?: string
          device_fingerprint?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          ip_asn?: string | null
          ip_country?: string | null
          last_seen_at?: string
          refresh_token_hash?: string
          reuse_detected_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_from_id?: string | null
          step_up_verified_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_rotated_from_id_fkey"
            columns: ["rotated_from_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          label: string
          slug: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          label: string
          slug: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          label?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          updated_by_id: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          updated_by_id?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          updated_by_id?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_updated_by_id_fkey"
            columns: ["updated_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_settings_updated_by_id_fkey"
            columns: ["updated_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_skills: {
        Row: {
          created_at: string
          is_primary: boolean
          proficiency: number
          skill_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_primary?: boolean
          proficiency: number
          skill_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_primary?: boolean
          proficiency?: number
          skill_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_skills_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_skills_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          account_state: Database["public"]["Enums"]["account_state"]
          avatar_url: string | null
          created_at: string
          created_by_id: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          locked_at: string | null
          max_concurrent_tasks: number
          notification_prefs: Json
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          role_title: string | null
          theme: Database["public"]["Enums"]["theme_preference"]
          timezone: string
          updated_at: string
          weekly_capacity_points: number
        }
        Insert: {
          account_state?: Database["public"]["Enums"]["account_state"]
          avatar_url?: string | null
          created_at?: string
          created_by_id?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          locked_at?: string | null
          max_concurrent_tasks?: number
          notification_prefs?: Json
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          role_title?: string | null
          theme?: Database["public"]["Enums"]["theme_preference"]
          timezone?: string
          updated_at?: string
          weekly_capacity_points?: number
        }
        Update: {
          account_state?: Database["public"]["Enums"]["account_state"]
          avatar_url?: string | null
          created_at?: string
          created_by_id?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          locked_at?: string | null
          max_concurrent_tasks?: number
          notification_prefs?: Json
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          role_title?: string | null
          theme?: Database["public"]["Enums"]["theme_preference"]
          timezone?: string
          updated_at?: string
          weekly_capacity_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "users_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      user_directory: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_state:
        | "pending_activation"
        | "active"
        | "password_reset_required"
        | "mfa_setup_required"
        | "locked"
        | "suspended"
        | "deactivated"
      audit_outcome: "success" | "denied" | "failed"
      auth_provider: "password" | "google" | "microsoft"
      invitation_purpose:
        | "activation"
        | "password_reset"
        | "account_unlock"
        | "email_change"
      login_outcome:
        | "success"
        | "bad_password"
        | "bad_mfa"
        | "locked"
        | "unknown_account"
      mfa_type: "totp" | "webauthn" | "recovery_codes"
      security_severity: "info" | "warning" | "critical"
      theme_preference: "light" | "dark" | "system"
      user_role: "super_admin" | "admin" | "team_coordinator" | "member"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_state: [
        "pending_activation",
        "active",
        "password_reset_required",
        "mfa_setup_required",
        "locked",
        "suspended",
        "deactivated",
      ],
      audit_outcome: ["success", "denied", "failed"],
      auth_provider: ["password", "google", "microsoft"],
      invitation_purpose: [
        "activation",
        "password_reset",
        "account_unlock",
        "email_change",
      ],
      login_outcome: [
        "success",
        "bad_password",
        "bad_mfa",
        "locked",
        "unknown_account",
      ],
      mfa_type: ["totp", "webauthn", "recovery_codes"],
      security_severity: ["info", "warning", "critical"],
      theme_preference: ["light", "dark", "system"],
      user_role: ["super_admin", "admin", "team_coordinator", "member"],
    },
  },
} as const
