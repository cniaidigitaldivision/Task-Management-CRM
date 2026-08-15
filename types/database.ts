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
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          comment_id: string | null
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          task_id: string
          uploaded_by_id: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          task_id: string
          uploaded_by_id: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          task_id?: string
          uploaded_by_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
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
      availability: {
        Row: {
          approved_by_id: string | null
          capacity_multiplier: number
          created_at: string
          end_date: string
          id: string
          note: string | null
          start_date: string
          type: Database["public"]["Enums"]["availability_type"]
          user_id: string
        }
        Insert: {
          approved_by_id?: string | null
          capacity_multiplier?: number
          created_at?: string
          end_date: string
          id?: string
          note?: string | null
          start_date: string
          type: Database["public"]["Enums"]["availability_type"]
          user_id: string
        }
        Update: {
          approved_by_id?: string | null
          capacity_multiplier?: number
          created_at?: string
          end_date?: string
          id?: string
          note?: string | null
          start_date?: string
          type?: Database["public"]["Enums"]["availability_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_approved_by_id_fkey"
            columns: ["approved_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_approved_by_id_fkey"
            columns: ["approved_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_user_id_fkey"
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
      checklist_items: {
        Row: {
          created_at: string
          id: string
          is_done: boolean
          sort_order: number
          task_id: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_done?: boolean
          sort_order?: number
          task_id: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          is_done?: boolean
          sort_order?: number
          task_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          mentions: string[]
          parent_comment_id: string | null
          task_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mentions?: string[]
          parent_comment_id?: string | null
          task_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mentions?: string[]
          parent_comment_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      credentials: {
        Row: {
          created_at: string
          created_by_id: string
          expires_at: string | null
          id: string
          issued_to_id: string | null
          kind: string
          label: string
          last_rotated_at: string | null
          notes: string | null
          project_id: string | null
          secret_encrypted: string
          updated_at: string
          updated_by_id: string | null
          url: string | null
          username: string | null
        }
        Insert: {
          created_at?: string
          created_by_id: string
          expires_at?: string | null
          id?: string
          issued_to_id?: string | null
          kind?: string
          label: string
          last_rotated_at?: string | null
          notes?: string | null
          project_id?: string | null
          secret_encrypted?: string
          updated_at?: string
          updated_by_id?: string | null
          url?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string
          created_by_id?: string
          expires_at?: string | null
          id?: string
          issued_to_id?: string | null
          kind?: string
          label?: string
          last_rotated_at?: string | null
          notes?: string | null
          project_id?: string | null
          secret_encrypted?: string
          updated_at?: string
          updated_by_id?: string | null
          url?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credentials_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_issued_to_id_fkey"
            columns: ["issued_to_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_issued_to_id_fkey"
            columns: ["issued_to_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_updated_by_id_fkey"
            columns: ["updated_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_updated_by_id_fkey"
            columns: ["updated_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by_id: string | null
          decision_reason: string | null
          description: string | null
          drive_file_id: string | null
          drive_web_link: string | null
          id: string
          mime_type: string | null
          name: string
          project_id: string | null
          size_bytes: number | null
          state: Database["public"]["Enums"]["document_state"]
          storage_path: string | null
          updated_at: string
          uploaded_by_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by_id?: string | null
          decision_reason?: string | null
          description?: string | null
          drive_file_id?: string | null
          drive_web_link?: string | null
          id?: string
          mime_type?: string | null
          name: string
          project_id?: string | null
          size_bytes?: number | null
          state?: Database["public"]["Enums"]["document_state"]
          storage_path?: string | null
          updated_at?: string
          uploaded_by_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by_id?: string | null
          decision_reason?: string | null
          description?: string | null
          drive_file_id?: string | null
          drive_web_link?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          project_id?: string | null
          size_bytes?: number | null
          state?: Database["public"]["Enums"]["document_state"]
          storage_path?: string | null
          updated_at?: string
          uploaded_by_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_decided_by_id_fkey"
            columns: ["decided_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_decided_by_id_fkey"
            columns: ["decided_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_sync: {
        Row: {
          id: number
          last_checked_at: string | null
          last_created: number
          last_error: string | null
          watched_folder_id: string | null
        }
        Insert: {
          id?: number
          last_checked_at?: string | null
          last_created?: number
          last_error?: string | null
          watched_folder_id?: string | null
        }
        Update: {
          id?: number
          last_checked_at?: string | null
          last_created?: number
          last_error?: string | null
          watched_folder_id?: string | null
        }
        Relationships: []
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string | null
          id: string
          is_read: boolean
          kind: Database["public"]["Enums"]["notification_kind"]
          link_to: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          id?: string
          is_read?: boolean
          kind: Database["public"]["Enums"]["notification_kind"]
          link_to?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          id?: string
          is_read?: boolean
          kind?: Database["public"]["Enums"]["notification_kind"]
          link_to?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          code: string
          created_at: string
          created_by_id: string
          description: string | null
          drive_folder_id: string | null
          id: string
          is_draft: boolean
          is_permanent: boolean
          name: string
          owner_id: string
          start_date: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["project_status"]
          status_reason: string | null
          target_end_date: string | null
          target_end_time: string | null
          type: Database["public"]["Enums"]["project_type"]
          type_fields: Json
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by_id: string
          description?: string | null
          drive_folder_id?: string | null
          id?: string
          is_draft?: boolean
          is_permanent?: boolean
          name: string
          owner_id: string
          start_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          status_reason?: string | null
          target_end_date?: string | null
          target_end_time?: string | null
          type: Database["public"]["Enums"]["project_type"]
          type_fields?: Json
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by_id?: string
          description?: string | null
          drive_folder_id?: string | null
          id?: string
          is_draft?: boolean
          is_permanent?: boolean
          name?: string
          owner_id?: string
          start_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          status_reason?: string | null
          target_end_date?: string | null
          target_end_time?: string | null
          type?: Database["public"]["Enums"]["project_type"]
          type_fields?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
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
      reference_counters: {
        Row: {
          code: string
          last_value: number
        }
        Insert: {
          code: string
          last_value?: number
        }
        Update: {
          code?: string
          last_value?: number
        }
        Relationships: []
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
      task_dependencies: {
        Row: {
          created_at: string
          depends_on_task_id: string
          task_id: string
          type: Database["public"]["Enums"]["dependency_type"]
        }
        Insert: {
          created_at?: string
          depends_on_task_id: string
          task_id: string
          type?: Database["public"]["Enums"]["dependency_type"]
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string
          task_id?: string
          type?: Database["public"]["Enums"]["dependency_type"]
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_skills: {
        Row: {
          skill_id: string
          task_id: string
          weight: number
        }
        Insert: {
          skill_id: string
          task_id: string
          weight?: number
        }
        Update: {
          skill_id?: string
          task_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_skills_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_watchers: {
        Row: {
          task_id: string
          user_id: string
        }
        Insert: {
          task_id: string
          user_id: string
        }
        Update: {
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_watchers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          assignment_override_reason: string | null
          assignment_score: number | null
          blocked_reason: string | null
          cancelled_reason: string | null
          completed_at: string | null
          created_at: string
          created_by_id: string
          deleted_at: string | null
          description: string | null
          due_date: string | null
          due_time: string | null
          effort_points: number
          effort_size: Database["public"]["Enums"]["effort_size"] | null
          extension_minutes_granted: number
          id: string
          is_deleted: boolean
          other_description: string | null
          over_limit_acknowledged_at: string | null
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string
          recurrence_rule: string | null
          reference: string
          start_date: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["task_status"]
          time_limit_minutes: number | null
          time_spent_minutes: number
          timer_alerts_sent: string[]
          timer_pause_reason:
            | Database["public"]["Enums"]["timer_pause_reason"]
            | null
          timer_started_at: string | null
          timer_state: Database["public"]["Enums"]["timer_state"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          assignment_override_reason?: string | null
          assignment_score?: number | null
          blocked_reason?: string | null
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_id: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          effort_points: number
          effort_size?: Database["public"]["Enums"]["effort_size"] | null
          extension_minutes_granted?: number
          id?: string
          is_deleted?: boolean
          other_description?: string | null
          over_limit_acknowledged_at?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id: string
          recurrence_rule?: string | null
          reference: string
          start_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_limit_minutes?: number | null
          time_spent_minutes?: number
          timer_alerts_sent?: string[]
          timer_pause_reason?:
            | Database["public"]["Enums"]["timer_pause_reason"]
            | null
          timer_started_at?: string | null
          timer_state?: Database["public"]["Enums"]["timer_state"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          assignment_override_reason?: string | null
          assignment_score?: number | null
          blocked_reason?: string | null
          cancelled_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by_id?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          effort_points?: number
          effort_size?: Database["public"]["Enums"]["effort_size"] | null
          extension_minutes_granted?: number
          id?: string
          is_deleted?: boolean
          other_description?: string | null
          over_limit_acknowledged_at?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string
          recurrence_rule?: string | null
          reference?: string
          start_date?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          time_limit_minutes?: number | null
          time_spent_minutes?: number
          timer_alerts_sent?: string[]
          timer_pause_reason?:
            | Database["public"]["Enums"]["timer_pause_reason"]
            | null
          timer_started_at?: string | null
          timer_state?: Database["public"]["Enums"]["timer_state"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          minutes: number | null
          reason: string | null
          source: Database["public"]["Enums"]["time_entry_source"]
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          minutes?: number | null
          reason?: string | null
          source?: Database["public"]["Enums"]["time_entry_source"]
          started_at: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          minutes?: number | null
          reason?: string | null
          source?: Database["public"]["Enums"]["time_entry_source"]
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      time_extension_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by_id: string | null
          decision_note: string | null
          granted_minutes: number | null
          id: string
          reason: string
          requested_by_id: string
          requested_minutes: number
          status: Database["public"]["Enums"]["extension_status"]
          task_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by_id?: string | null
          decision_note?: string | null
          granted_minutes?: number | null
          id?: string
          reason: string
          requested_by_id: string
          requested_minutes: number
          status?: Database["public"]["Enums"]["extension_status"]
          task_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by_id?: string | null
          decision_note?: string | null
          granted_minutes?: number | null
          id?: string
          reason?: string
          requested_by_id?: string
          requested_minutes?: number
          status?: Database["public"]["Enums"]["extension_status"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_extension_requests_decided_by_id_fkey"
            columns: ["decided_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_extension_requests_decided_by_id_fkey"
            columns: ["decided_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_extension_requests_requested_by_id_fkey"
            columns: ["requested_by_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_extension_requests_requested_by_id_fkey"
            columns: ["requested_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_extension_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
      availability_type: "leave" | "holiday" | "half_day" | "unavailable"
      dependency_type: "blocks" | "relates_to"
      document_state: "pending" | "approved" | "rejected"
      effort_size: "XS" | "S" | "M" | "L" | "XL"
      extension_status:
        | "pending"
        | "approved"
        | "partially_approved"
        | "declined"
        | "cancelled"
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
      notification_kind:
        | "task_assigned"
        | "task_reassigned"
        | "task_status_changed"
        | "task_blocked"
        | "task_due_soon"
        | "task_overdue"
        | "task_comment"
        | "task_mention"
        | "review_requested"
        | "review_approved"
        | "revisions_requested"
        | "capacity_warning"
        | "time_limit_warning"
        | "time_extension_requested"
        | "time_extension_decided"
        | "project_status_changed"
        | "security_alert"
      project_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "archived"
        | "cancelled"
      project_type: "event" | "client" | "business" | "self_promotion" | "other"
      security_severity: "info" | "warning" | "critical"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status:
        | "backlog"
        | "todo"
        | "in_progress"
        | "blocked"
        | "in_review"
        | "revisions"
        | "done"
        | "cancelled"
      theme_preference: "light" | "dark" | "system"
      time_entry_source: "timer" | "manual" | "adjustment"
      timer_pause_reason:
        | "status_change"
        | "outside_hours"
        | "leave"
        | "idle"
        | "manual"
      timer_state: "not_started" | "running" | "paused" | "stopped"
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
      availability_type: ["leave", "holiday", "half_day", "unavailable"],
      dependency_type: ["blocks", "relates_to"],
      document_state: ["pending", "approved", "rejected"],
      effort_size: ["XS", "S", "M", "L", "XL"],
      extension_status: [
        "pending",
        "approved",
        "partially_approved",
        "declined",
        "cancelled",
      ],
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
      notification_kind: [
        "task_assigned",
        "task_reassigned",
        "task_status_changed",
        "task_blocked",
        "task_due_soon",
        "task_overdue",
        "task_comment",
        "task_mention",
        "review_requested",
        "review_approved",
        "revisions_requested",
        "capacity_warning",
        "time_limit_warning",
        "time_extension_requested",
        "time_extension_decided",
        "project_status_changed",
        "security_alert",
      ],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "archived",
        "cancelled",
      ],
      project_type: ["event", "client", "business", "self_promotion", "other"],
      security_severity: ["info", "warning", "critical"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: [
        "backlog",
        "todo",
        "in_progress",
        "blocked",
        "in_review",
        "revisions",
        "done",
        "cancelled",
      ],
      theme_preference: ["light", "dark", "system"],
      time_entry_source: ["timer", "manual", "adjustment"],
      timer_pause_reason: [
        "status_change",
        "outside_hours",
        "leave",
        "idle",
        "manual",
      ],
      timer_state: ["not_started", "running", "paused", "stopped"],
      user_role: ["super_admin", "admin", "team_coordinator", "member"],
    },
  },
} as const
