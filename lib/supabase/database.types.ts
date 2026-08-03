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
          post_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: Database["public"]["Enums"]["boost_currency"]
          expires_at: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["boost_currency"]
          expires_at?: string
          id?: string
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
          closes_at: string | null
          created_at: string
          id: string
          is_anonymous: boolean
          post_id: string | null
          question: string
          state: Database["public"]["Enums"]["entry_state"]
          total_votes: number
        }
        Insert: {
          author_id: string
          closes_at?: string | null
          created_at?: string
          id?: string
          is_anonymous?: boolean
          post_id?: string | null
          question: string
          state?: Database["public"]["Enums"]["entry_state"]
          total_votes?: number
        }
        Update: {
          author_id?: string
          closes_at?: string | null
          created_at?: string
          id?: string
          is_anonymous?: boolean
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
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      compute_hot_score: {
        Args: { p_created: string; p_replies: number; p_upvotes: number }
        Returns: number
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
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ingest_consume_model_budget: { Args: { p_max: number }; Returns: boolean }
      is_blocked_with: { Args: { p_other: string }; Returns: boolean }
      is_refuge_member: { Args: { p_refuge: string }; Returns: boolean }
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
      refuge_has_block: {
        Args: { p_refuge: string; p_user: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      spend_crystals: {
        Args: { p_amount: number; p_reason: string; p_user: string }
        Returns: boolean
      }
      spend_karma: {
        Args: { p_amount: number; p_reason: string; p_user: string }
        Returns: boolean
      }
    }
    Enums: {
      boost_currency: "karma" | "crystals"
      content_state: "pending" | "approved" | "rejected"
      entry_state: "active" | "hidden" | "removed"
      flag_state: "pending" | "reviewing" | "resolved" | "dismissed"
      post_kind: "desahogo" | "pregunta" | "gratitud"
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
      boost_currency: ["karma", "crystals"],
      content_state: ["pending", "approved", "rejected"],
      entry_state: ["active", "hidden", "removed"],
      flag_state: ["pending", "reviewing", "resolved", "dismissed"],
      post_kind: ["desahogo", "pregunta", "gratitud"],
      refuge_kind: ["duo", "circulo"],
      risk_level: ["none", "low", "high", "critical"],
    },
  },
} as const
