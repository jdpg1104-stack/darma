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
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          params: Json
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          params?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          params?: Json
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_metrics_daily: {
        Row: {
          calculado_en: string
          dia: string
          metricas: Json
        }
        Insert: {
          calculado_en?: string
          dia: string
          metricas: Json
        }
        Update: {
          calculado_en?: string
          dia?: string
          metricas?: Json
        }
        Relationships: []
      }
      admin_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["admin_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["admin_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["admin_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_totp: {
        Row: {
          confirmed_at: string | null
          created_at: string
          recovery_hashes: string[]
          secret_encrypted: string
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          recovery_hashes?: string[]
          secret_encrypted: string
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          recovery_hashes?: string[]
          secret_encrypted?: string
          user_id?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          mode: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          mode?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          mode?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boosts: {
        Row: {
          amount: number
          created_at: string
          currency: Database["public"]["Enums"]["boost_currency"]
          expires_at: string
          id: string
          idempotency_key: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: Database["public"]["Enums"]["boost_currency"]
          expires_at: string
          id?: string
          idempotency_key?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["boost_currency"]
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boosts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boosts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_helpful: boolean
          is_validated: boolean
          post_id: string
          quality_score: number | null
          state: Database["public"]["Enums"]["entry_state"]
          upvote_count: number
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_helpful?: boolean
          is_validated?: boolean
          post_id: string
          quality_score?: number | null
          state?: Database["public"]["Enums"]["entry_state"]
          upvote_count?: number
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_helpful?: boolean
          is_validated?: boolean
          post_id?: string
          quality_score?: number | null
          state?: Database["public"]["Enums"]["entry_state"]
          upvote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          accepted_at: string
          kind: string
          revoked_at: string | null
          text_sha256: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          kind: string
          revoked_at?: string | null
          text_sha256: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          kind?: string
          revoked_at?: string | null
          text_sha256?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          completion_count: number
          created_at: string
          duration_seconds: number | null
          external_id: string
          id: string
          language: string
          performance_score: number
          platform: string
          published_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          state: Database["public"]["Enums"]["content_state"]
          summary: string | null
          tags: string[]
          thumbnail_url: string | null
          title: string
          topic: string | null
          url: string
          view_count: number
        }
        Insert: {
          completion_count?: number
          created_at?: string
          duration_seconds?: number | null
          external_id: string
          id?: string
          language?: string
          performance_score?: number
          platform: string
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          state?: Database["public"]["Enums"]["content_state"]
          summary?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title: string
          topic?: string | null
          url: string
          view_count?: number
        }
        Update: {
          completion_count?: number
          created_at?: string
          duration_seconds?: number | null
          external_id?: string
          id?: string
          language?: string
          performance_score?: number
          platform?: string
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          state?: Database["public"]["Enums"]["content_state"]
          summary?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          topic?: string | null
          url?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_items_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_sessions: {
        Row: {
          beats: number
          closed_at: string | null
          content_id: string
          credited_seconds: number
          id: string
          last_beat_at: string
          opened_at: string
          user_id: string
        }
        Insert: {
          beats?: number
          closed_at?: string | null
          content_id: string
          credited_seconds?: number
          id?: string
          last_beat_at?: string
          opened_at?: string
          user_id: string
        }
        Update: {
          beats?: number
          closed_at?: string | null
          content_id?: string
          credited_seconds?: number
          id?: string
          last_beat_at?: string
          opened_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_sessions_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_views: {
        Row: {
          completed: boolean
          completed_at: string | null
          content_id: string
          created_at: string
          user_id: string
          watched_seconds: number
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          content_id: string
          created_at?: string
          user_id: string
          watched_seconds?: number
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          content_id?: string
          created_at?: string
          user_id?: string
          watched_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_views_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crisis_events: {
        Row: {
          attended_at: string | null
          country_code: string | null
          created_at: string
          human_reviewed: boolean
          id: number
          outcome: string | null
          ref_bigint: number | null
          ref_id: string | null
          ref_type: string | null
          resources_shown: string[]
          reviewer_id: string | null
          risk: Database["public"]["Enums"]["risk_level"]
          user_id: string
        }
        Insert: {
          attended_at?: string | null
          country_code?: string | null
          created_at?: string
          human_reviewed?: boolean
          id?: never
          outcome?: string | null
          ref_bigint?: number | null
          ref_id?: string | null
          ref_type?: string | null
          resources_shown?: string[]
          reviewer_id?: string | null
          risk: Database["public"]["Enums"]["risk_level"]
          user_id: string
        }
        Update: {
          attended_at?: string | null
          country_code?: string | null
          created_at?: string
          human_reviewed?: boolean
          id?: never
          outcome?: string | null
          ref_bigint?: number | null
          ref_id?: string | null
          ref_type?: string | null
          resources_shown?: string[]
          reviewer_id?: string | null
          risk?: Database["public"]["Enums"]["risk_level"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crisis_events_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crisis_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_leases: {
        Row: {
          expira_en: string
          nombre: string
          tomado_en: string
        }
        Insert: {
          expira_en: string
          nombre: string
          tomado_en?: string
        }
        Update: {
          expira_en?: string
          nombre?: string
          tomado_en?: string
        }
        Relationships: []
      }
      cron_runs: {
        Row: {
          creado_en: string
          despacho: string
          detalle: Json
          estado: string
          id: number
          iniciado_en: string
          ms: number
          trabajo: string
        }
        Insert: {
          creado_en?: string
          despacho: string
          detalle?: Json
          estado: string
          id?: never
          iniciado_en: string
          ms: number
          trabajo: string
        }
        Update: {
          creado_en?: string
          despacho?: string
          detalle?: Json
          estado?: string
          id?: never
          iniciado_en?: string
          ms?: number
          trabajo?: string
        }
        Relationships: []
      }
      crystal_ledger: {
        Row: {
          created_at: string
          delta: number
          external_id: string | null
          id: number
          raw_receipt: Json | null
          reason: string
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          external_id?: string | null
          id?: never
          raw_receipt?: Json | null
          reason: string
          source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          external_id?: string | null
          id?: never
          raw_receipt?: Json | null
          reason?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crystal_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gifts: {
        Row: {
          cost_crystals: number
          created_at: string
          fee_crystals: number
          gift_kind: string
          id: string
          idempotency_key: string | null
          message: string | null
          net_crystals: number
          recipient_id: string
          ref_id: string | null
          ref_type: string | null
          sender_id: string
        }
        Insert: {
          cost_crystals: number
          created_at?: string
          fee_crystals?: number
          gift_kind: string
          id?: string
          idempotency_key?: string | null
          message?: string | null
          net_crystals: number
          recipient_id: string
          ref_id?: string | null
          ref_type?: string | null
          sender_id: string
        }
        Update: {
          cost_crystals?: number
          created_at?: string
          fee_crystals?: number
          gift_kind?: string
          id?: string
          idempotency_key?: string | null
          message?: string | null
          net_crystals?: number
          recipient_id?: string
          ref_id?: string | null
          ref_type?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gifts_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gifts_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_backups: {
        Row: {
          created_at: string
          kdf_iterations: number
          kdf_salt: string
          user_id: string
          wrap_nonce: string
          wrapped_identity: string
        }
        Insert: {
          created_at?: string
          kdf_iterations: number
          kdf_salt: string
          user_id: string
          wrap_nonce: string
          wrapped_identity: string
        }
        Update: {
          created_at?: string
          kdf_iterations?: number
          kdf_salt?: string
          user_id?: string
          wrap_nonce?: string
          wrapped_identity?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_backups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_vault: {
        Row: {
          contact_hash: string
          country_code: string | null
          created_at: string
          kyc_level: number
          user_id: string
        }
        Insert: {
          contact_hash: string
          country_code?: string | null
          created_at?: string
          kyc_level?: number
          user_id: string
        }
        Update: {
          contact_hash?: string
          country_code?: string | null
          created_at?: string
          kyc_level?: number
          user_id?: string
        }
        Relationships: []
      }
      ingest_log: {
        Row: {
          created_at: string
          decision: string
          external_id: string
          id: number
          platform: string
          reason: string | null
          source_key: string
        }
        Insert: {
          created_at?: string
          decision: string
          external_id: string
          id?: never
          platform: string
          reason?: string | null
          source_key: string
        }
        Update: {
          created_at?: string
          decision?: string
          external_id?: string
          id?: never
          platform?: string
          reason?: string | null
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_log_source_key_fkey"
            columns: ["source_key"]
            isOneToOne: false
            referencedRelation: "ingest_sources"
            referencedColumns: ["key"]
          },
        ]
      }
      ingest_model_budget: {
        Row: {
          calls: number
          day: string
        }
        Insert: {
          calls?: number
          day: string
        }
        Update: {
          calls?: number
          day?: string
        }
        Relationships: []
      }
      ingest_sources: {
        Row: {
          consecutive_failures: number
          cooldown_until: string | null
          created_at: string
          cursor: string | null
          disabled_reason: string | null
          enabled: boolean
          handle: string
          key: string
          kind: string
          language: string
          last_ok_at: string | null
          last_run_at: string | null
          topic: string | null
        }
        Insert: {
          consecutive_failures?: number
          cooldown_until?: string | null
          created_at?: string
          cursor?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          handle: string
          key: string
          kind: string
          language: string
          last_ok_at?: string | null
          last_run_at?: string | null
          topic?: string | null
        }
        Update: {
          consecutive_failures?: number
          cooldown_until?: string | null
          created_at?: string
          cursor?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          handle?: string
          key?: string
          kind?: string
          language?: string
          last_ok_at?: string | null
          last_run_at?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      ingest_state: {
        Row: {
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      karma_events: {
        Row: {
          created_at: string
          delta_reputation: number
          delta_spendable: number
          id: number
          idempotency_key: string | null
          kind: string
          ref_id: string | null
          ref_type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta_reputation: number
          delta_spendable: number
          id?: never
          idempotency_key?: string | null
          kind: string
          ref_id?: string | null
          ref_type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta_reputation?: number
          delta_spendable?: number
          id?: never
          idempotency_key?: string | null
          kind?: string
          ref_id?: string | null
          ref_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "karma_events_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "karma_weights"
            referencedColumns: ["kind"]
          },
          {
            foreignKeyName: "karma_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      karma_weights: {
        Row: {
          counts_to_cap: boolean
          description: string
          kind: string
          reputation: number
          spendable_pct: number
        }
        Insert: {
          counts_to_cap?: boolean
          description: string
          kind: string
          reputation: number
          spendable_pct?: number
        }
        Update: {
          counts_to_cap?: boolean
          description?: string
          kind?: string
          reputation?: number
          spendable_pct?: number
        }
        Relationships: []
      }
      kindred: {
        Row: {
          created_at: string
          kindred_id: string
          note: string | null
          owner_id: string
        }
        Insert: {
          created_at?: string
          kindred_id: string
          note?: string | null
          owner_id: string
        }
        Update: {
          created_at?: string
          kindred_id?: string
          note?: string | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kindred_kindred_id_fkey"
            columns: ["kindred_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kindred_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listen_daily: {
        Row: {
          day: string
          listens: number
          user_id: string
        }
        Insert: {
          day: string
          listens?: number
          user_id: string
        }
        Update: {
          day?: string
          listens?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listen_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_flags: {
        Row: {
          created_at: string
          detail: string | null
          id: number
          ref_bigint: number | null
          ref_id: string | null
          ref_type: string
          reporter_id: string | null
          resolved_at: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          severity: number
          signal: string
          state: Database["public"]["Enums"]["flag_state"]
          subject_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: never
          ref_bigint?: number | null
          ref_id?: string | null
          ref_type: string
          reporter_id?: string | null
          resolved_at?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          severity?: number
          signal: string
          state?: Database["public"]["Enums"]["flag_state"]
          subject_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: never
          ref_bigint?: number | null
          ref_id?: string | null
          ref_type?: string
          reporter_id?: string | null
          resolved_at?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          severity?: number
          signal?: string
          state?: Database["public"]["Enums"]["flag_state"]
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_flags_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_flags_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_flags_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          prefs: Json
          quiet_from: number | null
          quiet_to: number | null
          tz_offset: number
          updated_at: string
          user_id: string
        }
        Insert: {
          prefs?: Json
          quiet_from?: number | null
          quiet_to?: number | null
          tz_offset?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          prefs?: Json
          quiet_from?: number | null
          quiet_to?: number | null
          tz_offset?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_bank: {
        Row: {
          enabled: boolean
          key: string
          language: string
          last_used_at: string | null
          options: string[]
          question: string
          times_used: number
          topic: string | null
        }
        Insert: {
          enabled?: boolean
          key: string
          language?: string
          last_used_at?: string | null
          options: string[]
          question: string
          times_used?: number
          topic?: string | null
        }
        Update: {
          enabled?: boolean
          key?: string
          language?: string
          last_used_at?: string | null
          options?: string[]
          question?: string
          times_used?: number
          topic?: string | null
        }
        Relationships: []
      }
      poll_cadence: {
        Row: {
          day: string
          last_shown_at: string | null
          shown_today: number
          user_id: string
        }
        Insert: {
          day?: string
          last_shown_at?: string | null
          shown_today?: number
          user_id: string
        }
        Update: {
          day?: string
          last_shown_at?: string | null
          shown_today?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_cadence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_dismissals: {
        Row: {
          created_at: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_dismissals_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_options: {
        Row: {
          id: string
          label: string
          ordinal: number
          poll_id: string
          vote_count: number
        }
        Insert: {
          id?: string
          label: string
          ordinal: number
          poll_id: string
          vote_count?: number
        }
        Update: {
          id?: string
          label?: string
          ordinal?: number
          poll_id?: string
          vote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_poll_votes_opcion_de_su_encuesta"
            columns: ["option_id", "poll_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id", "poll_id"]
          },
          {
            foreignKeyName: "poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          author_id: string
          bank_key: string | null
          closes_at: string | null
          created_at: string
          id: string
          is_anonymous: boolean
          language: string
          min_reveal: number
          origin: string
          post_id: string | null
          question: string
          state: Database["public"]["Enums"]["entry_state"]
          total_votes: number
        }
        Insert: {
          author_id: string
          bank_key?: string | null
          closes_at?: string | null
          created_at?: string
          id?: string
          is_anonymous?: boolean
          language?: string
          min_reveal?: number
          origin?: string
          post_id?: string | null
          question: string
          state?: Database["public"]["Enums"]["entry_state"]
          total_votes?: number
        }
        Update: {
          author_id?: string
          bank_key?: string | null
          closes_at?: string | null
          created_at?: string
          id?: string
          is_anonymous?: boolean
          language?: string
          min_reveal?: number
          origin?: string
          post_id?: string | null
          question?: string
          state?: Database["public"]["Enums"]["entry_state"]
          total_votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "polls_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polls_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_votes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_votes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          body: string
          boost_until: string | null
          created_at: string
          hot_score: number
          id: string
          kind: Database["public"]["Enums"]["post_kind"]
          reply_count: number
          risk: Database["public"]["Enums"]["risk_level"]
          state: Database["public"]["Enums"]["entry_state"]
          topic: string | null
          updated_at: string
          upvote_count: number
        }
        Insert: {
          author_id: string
          body: string
          boost_until?: string | null
          created_at?: string
          hot_score?: number
          id?: string
          kind?: Database["public"]["Enums"]["post_kind"]
          reply_count?: number
          risk?: Database["public"]["Enums"]["risk_level"]
          state?: Database["public"]["Enums"]["entry_state"]
          topic?: string | null
          updated_at?: string
          upvote_count?: number
        }
        Update: {
          author_id?: string
          body?: string
          boost_until?: string | null
          created_at?: string
          hot_score?: number
          id?: string
          kind?: Database["public"]["Enums"]["post_kind"]
          reply_count?: number
          risk?: Database["public"]["Enums"]["risk_level"]
          state?: Database["public"]["Enums"]["entry_state"]
          topic?: string | null
          updated_at?: string
          upvote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_requests: {
        Row: {
          completed_at: string | null
          confirmed_at: string | null
          error: string | null
          expires_at: string
          id: string
          kind: Database["public"]["Enums"]["privacy_request_kind"]
          requested_at: string
          state: Database["public"]["Enums"]["privacy_request_state"]
          token_sha256: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmed_at?: string | null
          error?: string | null
          expires_at: string
          id?: string
          kind: Database["public"]["Enums"]["privacy_request_kind"]
          requested_at?: string
          state?: Database["public"]["Enums"]["privacy_request_state"]
          token_sha256: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          confirmed_at?: string | null
          error?: string | null
          expires_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["privacy_request_kind"]
          requested_at?: string
          state?: Database["public"]["Enums"]["privacy_request_state"]
          token_sha256?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          alias: string
          availability: string
          avatar_seed: string
          banned_until: string | null
          bio: string | null
          created_at: string
          crystals: number
          daily_karma_date: string
          daily_karma_earned: number
          deleted_at: string | null
          entry_level: string
          id: string
          karma_reputation: number
          karma_spendable: number
          last_seen_at: string
          level: string
          listen_credits: number
          listens_given: number
          posts_published: number
          shadow_banned: boolean
          streak_days: number
          streak_last_date: string | null
        }
        Insert: {
          alias: string
          availability?: string
          avatar_seed?: string
          banned_until?: string | null
          bio?: string | null
          created_at?: string
          crystals?: number
          daily_karma_date?: string
          daily_karma_earned?: number
          deleted_at?: string | null
          entry_level?: string
          id: string
          karma_reputation?: number
          karma_spendable?: number
          last_seen_at?: string
          level?: string
          listen_credits?: number
          listens_given?: number
          posts_published?: number
          shadow_banned?: boolean
          streak_days?: number
          streak_last_date?: string | null
        }
        Update: {
          alias?: string
          availability?: string
          avatar_seed?: string
          banned_until?: string | null
          bio?: string | null
          created_at?: string
          crystals?: number
          daily_karma_date?: string
          daily_karma_earned?: number
          deleted_at?: string | null
          entry_level?: string
          id?: string
          karma_reputation?: number
          karma_spendable?: number
          last_seen_at?: string
          level?: string
          listen_credits?: number
          listens_given?: number
          posts_published?: number
          shadow_banned?: boolean
          streak_days?: number
          streak_last_date?: string | null
        }
        Relationships: []
      }
      push_dispatch_state: {
        Row: {
          diferido_hasta: string | null
          last_sent_at: string | null
          pendientes: number
          tipo: string
          user_id: string
        }
        Insert: {
          diferido_hasta?: string | null
          last_sent_at?: string | null
          pendientes?: number
          tipo: string
          user_id: string
        }
        Update: {
          diferido_hasta?: string | null
          last_sent_at?: string | null
          pendientes?: number
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_dispatch_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_ok_at: string | null
          p256dh: string
          user_agent_hash: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_ok_at?: string | null
          p256dh: string
          user_agent_hash?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_ok_at?: string | null
          p256dh?: string
          user_agent_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ranking_snapshots: {
        Row: {
          built_at: string
          listens: number
          period: string
          period_start: string
          prev_rank: number | null
          rank: number
          user_id: string
        }
        Insert: {
          built_at?: string
          listens: number
          period: string
          period_start: string
          prev_rank?: number | null
          rank: number
          user_id: string
        }
        Update: {
          built_at?: string
          listens?: number
          period?: string
          period_start?: string
          prev_rank?: number | null
          rank?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranking_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      refuge_key_envelopes: {
        Row: {
          created_at: string
          key_version: number
          recipient_id: string
          refuge_id: string
          sender_fingerprint: string
          sender_id: string
          wrap_nonce: string
          wrapped_key: string
        }
        Insert: {
          created_at?: string
          key_version?: number
          recipient_id: string
          refuge_id: string
          sender_fingerprint: string
          sender_id: string
          wrap_nonce: string
          wrapped_key: string
        }
        Update: {
          created_at?: string
          key_version?: number
          recipient_id?: string
          refuge_id?: string
          sender_fingerprint?: string
          sender_id?: string
          wrap_nonce?: string
          wrapped_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "refuge_key_envelopes_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refuge_key_envelopes_refuge_id_fkey"
            columns: ["refuge_id"]
            isOneToOne: false
            referencedRelation: "refuges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refuge_key_envelopes_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refuge_members: {
        Row: {
          is_host: boolean
          joined_at: string
          last_read_message_id: number | null
          left_at: string | null
          muted: boolean
          refuge_id: string
          user_id: string
        }
        Insert: {
          is_host?: boolean
          joined_at?: string
          last_read_message_id?: number | null
          left_at?: string | null
          muted?: boolean
          refuge_id: string
          user_id: string
        }
        Update: {
          is_host?: boolean
          joined_at?: string
          last_read_message_id?: number | null
          left_at?: string | null
          muted?: boolean
          refuge_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refuge_members_refuge_id_fkey"
            columns: ["refuge_id"]
            isOneToOne: false
            referencedRelation: "refuges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refuge_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refuge_messages: {
        Row: {
          byte_size: number
          ciphertext: string
          created_at: string
          enc_version: number
          id: number
          kind: string
          nonce: string
          refuge_id: string
          sender_id: string
          state: Database["public"]["Enums"]["entry_state"]
        }
        Insert: {
          byte_size?: number
          ciphertext: string
          created_at?: string
          enc_version?: number
          id?: never
          kind?: string
          nonce: string
          refuge_id: string
          sender_id: string
          state?: Database["public"]["Enums"]["entry_state"]
        }
        Update: {
          byte_size?: number
          ciphertext?: string
          created_at?: string
          enc_version?: number
          id?: never
          kind?: string
          nonce?: string
          refuge_id?: string
          sender_id?: string
          state?: Database["public"]["Enums"]["entry_state"]
        }
        Relationships: [
          {
            foreignKeyName: "refuge_messages_refuge_id_fkey"
            columns: ["refuge_id"]
            isOneToOne: false
            referencedRelation: "refuges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refuge_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refuges: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["refuge_kind"]
          last_message_at: string | null
          max_members: number
          member_count: number
          message_count: number
          title: string | null
          topic: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          kind?: Database["public"]["Enums"]["refuge_kind"]
          last_message_at?: string | null
          max_members?: number
          member_count?: number
          message_count?: number
          title?: string | null
          topic?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["refuge_kind"]
          last_message_at?: string | null
          max_members?: number
          member_count?: number
          message_count?: number
          title?: string | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refuges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retired_aliases: {
        Row: {
          alias: string
          retired_at: string
          user_id: string | null
        }
        Insert: {
          alias: string
          retired_at?: string
          user_id?: string | null
        }
        Update: {
          alias?: string
          retired_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retired_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_keys: {
        Row: {
          created_at: string
          fingerprint: string
          key_version: number
          public_jwk: Json
          rotated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          fingerprint: string
          key_version?: number
          public_jwk: Json
          rotated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          fingerprint?: string
          key_version?: number
          public_jwk?: Json
          rotated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abrir_sesion_contenido: {
        Args: { p_content: string; p_user: string }
        Returns: string
      }
      acreditar_compra: {
        Args: {
          p_delta: number
          p_external_id: string
          p_reason: string
          p_receipt?: Json
          p_source: string
          p_user: string
        }
        Returns: {
          acreditado: boolean
          saldo: number
        }[]
      }
      admin_auditar: {
        Args: {
          p_action: string
          p_actor: string
          p_params?: Json
          p_target_id?: string
          p_target_type?: string
        }
        Returns: undefined
      }
      admin_conceder_rol: {
        Args: {
          p_actor: string
          p_rol: Database["public"]["Enums"]["admin_role"]
          p_sujeto: string
        }
        Returns: undefined
      }
      admin_cubos_ttpr: { Args: never; Returns: number[] }
      admin_metricas_ventana: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          calculado_en: string
          dia: string
          metricas: Json
        }[]
      }
      admin_revocar_rol: {
        Args: { p_actor: string; p_sujeto: string }
        Returns: undefined
      }
      admin_rollup_dia: { Args: { p_dia: string }; Returns: undefined }
      alias_disponible: { Args: { p_alias: string }; Returns: boolean }
      award_karma: {
        Args: {
          p_idem?: string
          p_kind: string
          p_ref_id?: string
          p_ref_type?: string
          p_user: string
        }
        Returns: number
      }
      b03_editar_post: {
        Args: {
          p_author: string
          p_body: string
          p_id: string
          p_pais?: string
          p_recursos?: string[]
          p_risk: Database["public"]["Enums"]["risk_level"]
          p_topic: string
        }
        Returns: {
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["post_kind"]
          topic: string
        }[]
      }
      b03_publicar_post: {
        Args: {
          p_author: string
          p_body: string
          p_kind: Database["public"]["Enums"]["post_kind"]
          p_pais?: string
          p_recursos?: string[]
          p_risk: Database["public"]["Enums"]["risk_level"]
          p_topic: string
        }
        Returns: {
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["post_kind"]
          topic: string
        }[]
      }
      b03_retirar_post: {
        Args: { p_author: string; p_id: string }
        Returns: boolean
      }
      b10_bandeja: {
        Args: { p_cursor_id: string; p_cursor_ts: string; p_limite: number }
        Returns: {
          id: string
          kind: Database["public"]["Enums"]["refuge_kind"]
          last_message_at: string
          last_read_message_id: number
          member_count: number
          message_count: number
          muted: boolean
          title: string
        }[]
      }
      b10_crear_refugio: {
        Args: {
          p_kind: Database["public"]["Enums"]["refuge_kind"]
          p_miembros: string[]
          p_title: string
          p_topic: string
        }
        Returns: string
      }
      b10_limitar: { Args: { p_accion: string }; Returns: boolean }
      b10_registrar_crisis_refugio: {
        Args: {
          p_country_code: string
          p_recursos: string[]
          p_refuge: string
          p_risk: Database["public"]["Enums"]["risk_level"]
        }
        Returns: undefined
      }
      barrer_sesiones_contenido: { Args: { p_max?: number }; Returns: number }
      boost_vivo: {
        Args: { p_post: string }
        Returns: {
          expires_at: string
          id: string
        }[]
      }
      borrados_vencidos: {
        Args: { p_limite?: number }
        Returns: {
          solicitud_id: string
          user_id: string
        }[]
      }
      borrar_usuario: { Args: { p_user: string }; Returns: Json }
      cancelar_borrado: { Args: { p_user: string }; Returns: boolean }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      completar_contenido: {
        Args: { p_content: string; p_session: string; p_user: string }
        Returns: {
          acreditado: boolean
          karma: number
          motivo: string
        }[]
      }
      compute_hot_score: {
        Args: { p_created: string; p_replies: number; p_upvotes: number }
        Returns: number
      }
      confirmar_borrado: {
        Args: { p_solicitud: string; p_token_sha256: string; p_user: string }
        Returns: boolean
      }
      construir_ranking_snapshot: {
        Args: {
          p_corte: string
          p_corte_anterior: string
          p_corte_fin: string
          p_desde_usuario?: string
          p_listens_dia_max: number
          p_max_filas?: number
          p_periodo: string
        }
        Returns: {
          completado: boolean
          filas: number
          ultimo_usuario: string
        }[]
      }
      consumir_exportacion: {
        Args: { p_solicitud: string; p_user: string }
        Returns: boolean
      }
      crear_encuesta: {
        Args: {
          p_autor: string
          p_cierra_en?: string
          p_estado?: Database["public"]["Enums"]["entry_state"]
          p_idioma?: string
          p_min_reveal?: number
          p_opciones: string[]
          p_pregunta: string
        }
        Returns: Json
      }
      crear_perfil: {
        Args: { p_alias: string; p_avatar_seed: string; p_entry_level: string }
        Returns: {
          alias: string
          availability: string
          avatar_seed: string
          banned_until: string | null
          bio: string | null
          created_at: string
          crystals: number
          daily_karma_date: string
          daily_karma_earned: number
          deleted_at: string | null
          entry_level: string
          id: string
          karma_reputation: number
          karma_spendable: number
          last_seen_at: string
          level: string
          listen_credits: number
          listens_given: number
          posts_published: number
          shadow_banned: boolean
          streak_days: number
          streak_last_date: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crear_solicitud_privacidad: {
        Args: {
          p_confirmada?: boolean
          p_kind: Database["public"]["Enums"]["privacy_request_kind"]
          p_token_sha256: string
          p_ttl_segundos: number
          p_user: string
        }
        Returns: string
      }
      cron_soltar_lease: { Args: { p_nombre: string }; Returns: undefined }
      cron_tomar_lease: {
        Args: { p_nombre: string; p_segundos?: number }
        Returns: boolean
      }
      destinatarios_alma_afin: {
        Args: { p_usuario: string }
        Returns: {
          owner_id: string
        }[]
      }
      encuesta_admite_voto: { Args: { p_poll: string }; Returns: boolean }
      encuesta_resultados: { Args: { p_poll: string }; Returns: Json }
      encuesta_siguiente: { Args: { p_idioma?: string }; Returns: Json }
      encuesta_visible: { Args: { p_poll: string }; Returns: boolean }
      enviar_regalo: {
        Args: {
          p_cost: number
          p_fee: number
          p_idem?: string
          p_kind: string
          p_message?: string
          p_net: number
          p_recipient: string
          p_ref_id?: string
          p_ref_type?: string
          p_sender: string
        }
        Returns: {
          regalo_id: string
          saldo: number
        }[]
      }
      esta_silenciado: { Args: { p_autor: string }; Returns: boolean }
      feed_animo: {
        Args: {
          p_cursor_id?: string
          p_cursor_score?: number
          p_idioma: string
          p_limite?: number
        }
        Returns: {
          duration_seconds: number
          external_id: string
          id: string
          language: string
          performance_score: number
          platform: string
          source: string
          thumbnail_url: string
          title: string
          topic: string
        }[]
      }
      feed_contenido_keyset: {
        Args: {
          p_cursor_id: string
          p_cursor_score: number
          p_idioma: string
          p_limite: number
        }
        Returns: {
          duration_seconds: number
          id: string
          performance_score: number
          platform: string
          summary: string
          thumbnail_url: string
          title: string
          topic: string
          url: string
        }[]
      }
      feed_encuestas_keyset: {
        Args: { p_cursor_creado: string; p_cursor_id: string; p_limite: number }
        Returns: {
          created_at: string
          id: string
        }[]
      }
      feed_keyset: {
        Args: { p_cursor_id: string; p_cursor_score: number; p_limite: number }
        Returns: {
          alias: string
          autor_id: string
          availability: string
          avatar_seed: string
          body: string
          boost_until: string
          created_at: string
          he_votado: boolean
          hot_score: number
          id: string
          karma_reputation: number
          kind: Database["public"]["Enums"]["post_kind"]
          level: string
          reply_count: number
          risk: Database["public"]["Enums"]["risk_level"]
          topic: string
          upvote_count: number
        }[]
      }
      feed_keyset_nuevo: {
        Args: { p_cursor_creado: string; p_cursor_id: string; p_limite: number }
        Returns: {
          alias: string
          autor_id: string
          availability: string
          avatar_seed: string
          body: string
          boost_until: string
          created_at: string
          he_votado: boolean
          hot_score: number
          id: string
          karma_reputation: number
          kind: Database["public"]["Enums"]["post_kind"]
          level: string
          reply_count: number
          risk: Database["public"]["Enums"]["risk_level"]
          topic: string
          upvote_count: number
        }[]
      }
      impulsar_post: {
        Args: {
          p_idem?: string
          p_medio?: string
          p_post: string
          p_user: string
        }
        Returns: {
          aplicado: boolean
          cupo_gratis_restante: number
          expira_en: string
          medio: string
        }[]
      }
      ingest_consume_model_budget: { Args: { p_max: number }; Returns: boolean }
      is_blocked_between: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      is_blocked_with: { Args: { p_other: string }; Returns: boolean }
      is_refuge_member: { Args: { p_refuge: string }; Returns: boolean }
      latido_contenido: {
        Args: { p_content: string; p_session: string; p_user: string }
        Returns: {
          acreditados: number
          faltan: number
          listo: boolean
        }[]
      }
      marcar_comentario_util: {
        Args: { p_actor: string; p_comment: string }
        Returns: {
          estado: string
          karma_otorgado: number
        }[]
      }
      mi_cupo_boost: {
        Args: never
        Returns: {
          boosts_hoy: number
          crystals: number
          cupo_gratis_restante: number
          karma_spendable: number
        }[]
      }
      mi_historial_cristales: {
        Args: { p_cursor?: number; p_limite?: number }
        Returns: {
          created_at: string
          delta: number
          id: number
          reason: string
          source: string
        }[]
      }
      mi_historial_karma: {
        Args: {
          p_cursor_created?: string
          p_cursor_id?: number
          p_limite?: number
        }
        Returns: {
          created_at: string
          delta_reputation: number
          delta_spendable: number
          id: number
          kind: string
          ref_id: string
          ref_type: string
        }[]
      }
      mi_perfil_privado: {
        Args: never
        Returns: {
          banned_until: string
          crystals: number
          daily_karma_earned: number
          karma_spendable: number
          listen_credits: number
          listens_given: number
          posts_published: number
        }[]
      }
      mi_resumen_karma: {
        Args: never
        Returns: {
          desglose_30d: Json
          ganado_hoy: number
          reputacion: number
          streak_days: number
          streak_last_date: string
        }[]
      }
      mi_sesion: {
        Args: never
        Returns: {
          alias: string
          availability: string
          avatar_seed: string
          banned_until: string
          bio: string
          entry_level: string
          id: string
          karma_reputation: number
          level: string
          shadow_banned: boolean
        }[]
      }
      purgar_cron_runs: {
        Args: { p_dias?: number; p_lote?: number }
        Returns: number
      }
      purgar_retencion: { Args: { p_lote?: number }; Returns: Json }
      ranking_fila: {
        Args: { p_corte: string; p_periodo: string; p_usuario?: string }
        Returns: {
          alias: string
          avatar_seed: string
          built_at: string
          level: string
          listens: number
          prev_rank: number
          rank: number
          user_id: string
        }[]
      }
      ranking_tablero: {
        Args: {
          p_corte: string
          p_cursor_rank?: number
          p_cursor_user?: string
          p_limite?: number
          p_periodo: string
        }
        Returns: {
          alias: string
          avatar_seed: string
          built_at: string
          level: string
          listens: number
          prev_rank: number
          rank: number
          user_id: string
        }[]
      }
      refuge_has_block: {
        Args: { p_refuge: string; p_user: string }
        Returns: boolean
      }
      registrar_consentimiento: {
        Args: {
          p_kind: string
          p_sha256: string
          p_user: string
          p_version: string
        }
        Returns: undefined
      }
      reponer_encuestas: {
        Args: { p_idioma?: string; p_max_dias?: number; p_minimo?: number }
        Returns: Json
      }
      rol_admin_actual: {
        Args: { p_user: string }
        Returns: Database["public"]["Enums"]["admin_role"]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soy_autor_encuesta: { Args: { p_poll: string }; Returns: boolean }
      spend_crystals: {
        Args: { p_amount: number; p_reason: string; p_user: string }
        Returns: boolean
      }
      spend_karma: {
        Args: { p_amount: number; p_reason: string; p_user: string }
        Returns: boolean
      }
      tiene_rol_admin: {
        Args: {
          p_minimo: Database["public"]["Enums"]["admin_role"]
          p_user: string
        }
        Returns: boolean
      }
    }
    Enums: {
      admin_role: "soporte" | "moderador" | "operaciones" | "superadmin"
      boost_currency: "karma" | "crystals"
      content_state: "pending" | "approved" | "rejected"
      entry_state: "active" | "hidden" | "removed"
      flag_state: "pending" | "reviewing" | "resolved" | "dismissed"
      post_kind: "desahogo" | "pregunta" | "gratitud"
      privacy_request_kind: "export" | "erase"
      privacy_request_state:
        | "pending_confirm"
        | "confirmed"
        | "processing"
        | "done"
        | "failed"
        | "cancelled"
      refuge_kind: "duo" | "circulo"
      risk_level: "none" | "low" | "high" | "critical"
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
      admin_role: ["soporte", "moderador", "operaciones", "superadmin"],
      boost_currency: ["karma", "crystals"],
      content_state: ["pending", "approved", "rejected"],
      entry_state: ["active", "hidden", "removed"],
      flag_state: ["pending", "reviewing", "resolved", "dismissed"],
      post_kind: ["desahogo", "pregunta", "gratitud"],
      privacy_request_kind: ["export", "erase"],
      privacy_request_state: [
        "pending_confirm",
        "confirmed",
        "processing",
        "done",
        "failed",
        "cancelled",
      ],
      refuge_kind: ["duo", "circulo"],
      risk_level: ["none", "low", "high", "critical"],
    },
  },
} as const
