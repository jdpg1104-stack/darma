// ============================================================================
// ARCHIVO GENERADO — NO LO EDITES A MANO.
//
// Se regenera con:
//
//   npx supabase gen types typescript --local > lib/supabase/database.types.ts
//
// y el CI lo vuelve a generar en cada PR (`.github/workflows/ci.yml`, paso
// «tipos») y hace `git diff --exit-code` sobre este archivo. Cualquier edición
// manual se revierte en la siguiente ejecución: si necesitas un cambio aquí, el
// cambio va en `supabase/migrations/**` y los tipos salen solos.
//
// Dueño: B15 (ver HANDOFF/CONTRATOS.md §3). Consúmelo así:
//
//   import type { Database } from '@/lib/supabase/database.types'
//   type PostRow = Database['public']['Tables']['posts']['Row']
//
// Nunca declares a mano la forma de una fila: si el esquema cambia, queremos que
// el compilador lo rompa, no que la app mienta en silencio.
//
// ── ESTADO ACTUAL (2026-08-03) ───────────────────────────────────────────────
// Esta versión está DERIVADA A MANO, línea a línea, de `0001_core.sql` y
// `0002_comunidad.sql`, porque en la máquina donde se cerró B15 no había Docker
// ni una Supabase local que levantar, y `supabase gen types --local` necesita la
// base en marcha. Se sube igualmente porque doce bloques en paralelo estaban
// bloqueados esperándola y la alternativa —que cada uno declarase sus filas a
// mano— es exactamente lo que CONTRATOS §3 prohíbe.
//
// La primera ejecución de CI con Supabase local sustituirá este archivo por el
// generado de verdad; `scripts/security/guardTipos.ts` fallará con el comando
// exacto si hay cualquier diferencia. Trátalo como provisional-pero-fiable, no
// como definitivo.
// ============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      // ── 0001 · núcleo ──────────────────────────────────────────────────────
      profiles: {
        Row: {
          id: string
          alias: string
          avatar_seed: string
          bio: string | null
          karma_reputation: number
          karma_spendable: number
          /** Columna GENERADA (stored) a partir de karma_reputation. No se escribe. */
          level: string
          listen_credits: number
          listens_given: number
          posts_published: number
          daily_karma_earned: number
          daily_karma_date: string
          crystals: number
          shadow_banned: boolean
          banned_until: string | null
          availability: string
          created_at: string
          last_seen_at: string
        }
        Insert: {
          id: string
          alias: string
          avatar_seed?: string
          bio?: string | null
          karma_reputation?: number
          karma_spendable?: number
          listen_credits?: number
          listens_given?: number
          posts_published?: number
          daily_karma_earned?: number
          daily_karma_date?: string
          crystals?: number
          shadow_banned?: boolean
          banned_until?: string | null
          availability?: string
          created_at?: string
          last_seen_at?: string
        }
        Update: {
          id?: string
          alias?: string
          avatar_seed?: string
          bio?: string | null
          karma_reputation?: number
          karma_spendable?: number
          listen_credits?: number
          listens_given?: number
          posts_published?: number
          daily_karma_earned?: number
          daily_karma_date?: string
          crystals?: number
          shadow_banned?: boolean
          banned_until?: string | null
          availability?: string
          created_at?: string
          last_seen_at?: string
        }
        Relationships: []
      }
      identity_vault: {
        Row: {
          user_id: string
          contact_hash: string
          country_code: string | null
          kyc_level: number
          created_at: string
        }
        Insert: {
          user_id: string
          contact_hash: string
          country_code?: string | null
          kyc_level?: number
          created_at?: string
        }
        Update: {
          user_id?: string
          contact_hash?: string
          country_code?: string | null
          kyc_level?: number
          created_at?: string
        }
        Relationships: []
      }
      karma_weights: {
        Row: {
          kind: string
          reputation: number
          spendable_pct: number
          description: string
          counts_to_cap: boolean
        }
        Insert: {
          kind: string
          reputation: number
          spendable_pct?: number
          description: string
          counts_to_cap?: boolean
        }
        Update: {
          kind?: string
          reputation?: number
          spendable_pct?: number
          description?: string
          counts_to_cap?: boolean
        }
        Relationships: []
      }
      karma_events: {
        Row: {
          id: number
          user_id: string
          kind: string
          delta_reputation: number
          delta_spendable: number
          ref_type: string | null
          ref_id: string | null
          idempotency_key: string | null
          created_at: string
        }
        Insert: {
          user_id: string
          kind: string
          delta_reputation: number
          delta_spendable: number
          ref_type?: string | null
          ref_id?: string | null
          idempotency_key?: string | null
          created_at?: string
        }
        Update: {
          user_id?: string
          kind?: string
          delta_reputation?: number
          delta_spendable?: number
          ref_type?: string | null
          ref_id?: string | null
          idempotency_key?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'karma_events_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'karma_events_kind_fkey'
            columns: ['kind']
            referencedRelation: 'karma_weights'
            referencedColumns: ['kind']
          },
        ]
      }
      posts: {
        Row: {
          id: string
          author_id: string
          kind: Database['public']['Enums']['post_kind']
          body: string
          topic: string | null
          upvote_count: number
          reply_count: number
          hot_score: number
          boost_until: string | null
          risk: Database['public']['Enums']['risk_level']
          state: Database['public']['Enums']['entry_state']
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          author_id: string
          kind?: Database['public']['Enums']['post_kind']
          body: string
          topic?: string | null
          upvote_count?: number
          reply_count?: number
          hot_score?: number
          boost_until?: string | null
          risk?: Database['public']['Enums']['risk_level']
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          author_id?: string
          kind?: Database['public']['Enums']['post_kind']
          body?: string
          topic?: string | null
          upvote_count?: number
          reply_count?: number
          hot_score?: number
          boost_until?: string | null
          risk?: Database['public']['Enums']['risk_level']
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'posts_author_id_fkey'
            columns: ['author_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      comments: {
        Row: {
          id: string
          post_id: string
          author_id: string
          body: string
          is_validated: boolean
          quality_score: number | null
          is_helpful: boolean
          upvote_count: number
          state: Database['public']['Enums']['entry_state']
          created_at: string
        }
        Insert: {
          id?: string
          post_id: string
          author_id: string
          body: string
          is_validated?: boolean
          quality_score?: number | null
          is_helpful?: boolean
          upvote_count?: number
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
        }
        Update: {
          id?: string
          post_id?: string
          author_id?: string
          body?: string
          is_validated?: boolean
          quality_score?: number | null
          is_helpful?: boolean
          upvote_count?: number
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'comments_post_id_fkey'
            columns: ['post_id']
            referencedRelation: 'posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_author_id_fkey'
            columns: ['author_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      post_votes: {
        Row: { post_id: string; user_id: string; created_at: string }
        Insert: { post_id: string; user_id: string; created_at?: string }
        Update: { post_id?: string; user_id?: string; created_at?: string }
        Relationships: [
          {
            foreignKeyName: 'post_votes_post_id_fkey'
            columns: ['post_id']
            referencedRelation: 'posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'post_votes_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }

      // ── 0002 · comunidad ───────────────────────────────────────────────────
      refuges: {
        Row: {
          id: string
          kind: Database['public']['Enums']['refuge_kind']
          title: string | null
          topic: string | null
          created_by: string
          max_members: number
          member_count: number
          message_count: number
          last_message_at: string | null
          archived_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          kind?: Database['public']['Enums']['refuge_kind']
          title?: string | null
          topic?: string | null
          created_by: string
          max_members?: number
          member_count?: number
          message_count?: number
          last_message_at?: string | null
          archived_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          kind?: Database['public']['Enums']['refuge_kind']
          title?: string | null
          topic?: string | null
          created_by?: string
          max_members?: number
          member_count?: number
          message_count?: number
          last_message_at?: string | null
          archived_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'refuges_created_by_fkey'
            columns: ['created_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      refuge_members: {
        Row: {
          refuge_id: string
          user_id: string
          is_host: boolean
          muted: boolean
          last_read_message_id: number | null
          joined_at: string
          left_at: string | null
        }
        Insert: {
          refuge_id: string
          user_id: string
          is_host?: boolean
          muted?: boolean
          last_read_message_id?: number | null
          joined_at?: string
          left_at?: string | null
        }
        Update: {
          refuge_id?: string
          user_id?: string
          is_host?: boolean
          muted?: boolean
          last_read_message_id?: number | null
          joined_at?: string
          left_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'refuge_members_refuge_id_fkey'
            columns: ['refuge_id']
            referencedRelation: 'refuges'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'refuge_members_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      refuge_messages: {
        Row: {
          id: number
          refuge_id: string
          sender_id: string
          /** bytea. PostgREST lo serializa como texto en hex (`\x…`). */
          ciphertext: string
          nonce: string
          enc_version: number
          kind: string
          byte_size: number
          state: Database['public']['Enums']['entry_state']
          created_at: string
        }
        Insert: {
          refuge_id: string
          sender_id: string
          ciphertext: string
          nonce: string
          enc_version?: number
          kind?: string
          byte_size?: number
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
        }
        Update: {
          refuge_id?: string
          sender_id?: string
          ciphertext?: string
          nonce?: string
          enc_version?: number
          kind?: string
          byte_size?: number
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'refuge_messages_refuge_id_fkey'
            columns: ['refuge_id']
            referencedRelation: 'refuges'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'refuge_messages_sender_id_fkey'
            columns: ['sender_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      kindred: {
        Row: { owner_id: string; kindred_id: string; note: string | null; created_at: string }
        Insert: { owner_id: string; kindred_id: string; note?: string | null; created_at?: string }
        Update: { owner_id?: string; kindred_id?: string; note?: string | null; created_at?: string }
        Relationships: [
          {
            foreignKeyName: 'kindred_owner_id_fkey'
            columns: ['owner_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kindred_kindred_id_fkey'
            columns: ['kindred_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      blocks: {
        Row: {
          blocker_id: string
          blocked_id: string
          mode: string
          reason: string | null
          created_at: string
        }
        Insert: {
          blocker_id: string
          blocked_id: string
          mode?: string
          reason?: string | null
          created_at?: string
        }
        Update: {
          blocker_id?: string
          blocked_id?: string
          mode?: string
          reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'blocks_blocker_id_fkey'
            columns: ['blocker_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'blocks_blocked_id_fkey'
            columns: ['blocked_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      content_items: {
        Row: {
          id: string
          source: string
          platform: string
          external_id: string
          title: string
          summary: string | null
          url: string
          thumbnail_url: string | null
          language: string
          duration_seconds: number | null
          topic: string | null
          tags: string[]
          state: Database['public']['Enums']['content_state']
          reviewed_by: string | null
          reviewed_at: string | null
          view_count: number
          completion_count: number
          performance_score: number
          published_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          source: string
          platform: string
          external_id: string
          title: string
          summary?: string | null
          url: string
          thumbnail_url?: string | null
          language?: string
          duration_seconds?: number | null
          topic?: string | null
          tags?: string[]
          state?: Database['public']['Enums']['content_state']
          reviewed_by?: string | null
          reviewed_at?: string | null
          view_count?: number
          completion_count?: number
          performance_score?: number
          published_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          source?: string
          platform?: string
          external_id?: string
          title?: string
          summary?: string | null
          url?: string
          thumbnail_url?: string | null
          language?: string
          duration_seconds?: number | null
          topic?: string | null
          tags?: string[]
          state?: Database['public']['Enums']['content_state']
          reviewed_by?: string | null
          reviewed_at?: string | null
          view_count?: number
          completion_count?: number
          performance_score?: number
          published_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'content_items_reviewed_by_fkey'
            columns: ['reviewed_by']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      content_views: {
        Row: {
          content_id: string
          user_id: string
          completed: boolean
          watched_seconds: number
          created_at: string
          completed_at: string | null
        }
        Insert: {
          content_id: string
          user_id: string
          completed?: boolean
          watched_seconds?: number
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          content_id?: string
          user_id?: string
          completed?: boolean
          watched_seconds?: number
          created_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'content_views_content_id_fkey'
            columns: ['content_id']
            referencedRelation: 'content_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'content_views_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      polls: {
        Row: {
          id: string
          post_id: string | null
          author_id: string
          question: string
          is_anonymous: boolean
          closes_at: string | null
          total_votes: number
          state: Database['public']['Enums']['entry_state']
          created_at: string
        }
        Insert: {
          id?: string
          post_id?: string | null
          author_id: string
          question: string
          is_anonymous?: boolean
          closes_at?: string | null
          total_votes?: number
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
        }
        Update: {
          id?: string
          post_id?: string | null
          author_id?: string
          question?: string
          is_anonymous?: boolean
          closes_at?: string | null
          total_votes?: number
          state?: Database['public']['Enums']['entry_state']
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'polls_post_id_fkey'
            columns: ['post_id']
            referencedRelation: 'posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'polls_author_id_fkey'
            columns: ['author_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      poll_options: {
        Row: { id: string; poll_id: string; ordinal: number; label: string; vote_count: number }
        Insert: { id?: string; poll_id: string; ordinal: number; label: string; vote_count?: number }
        Update: { id?: string; poll_id?: string; ordinal?: number; label?: string; vote_count?: number }
        Relationships: [
          {
            foreignKeyName: 'poll_options_poll_id_fkey'
            columns: ['poll_id']
            referencedRelation: 'polls'
            referencedColumns: ['id']
          },
        ]
      }
      poll_votes: {
        Row: { poll_id: string; option_id: string; user_id: string; created_at: string }
        Insert: { poll_id: string; option_id: string; user_id: string; created_at?: string }
        Update: { poll_id?: string; option_id?: string; user_id?: string; created_at?: string }
        Relationships: [
          {
            foreignKeyName: 'poll_votes_poll_id_fkey'
            columns: ['poll_id']
            referencedRelation: 'polls'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'poll_votes_option_id_fkey'
            columns: ['option_id']
            referencedRelation: 'poll_options'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'poll_votes_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      moderation_flags: {
        Row: {
          id: number
          ref_type: string
          ref_id: string | null
          ref_bigint: number | null
          subject_id: string | null
          reporter_id: string | null
          signal: string
          severity: number
          detail: string | null
          state: Database['public']['Enums']['flag_state']
          reviewer_id: string | null
          created_at: string
          reviewed_at: string | null
          resolved_at: string | null
        }
        Insert: {
          ref_type: string
          ref_id?: string | null
          ref_bigint?: number | null
          subject_id?: string | null
          reporter_id?: string | null
          signal: string
          severity?: number
          detail?: string | null
          state?: Database['public']['Enums']['flag_state']
          reviewer_id?: string | null
          created_at?: string
          reviewed_at?: string | null
          resolved_at?: string | null
        }
        Update: {
          ref_type?: string
          ref_id?: string | null
          ref_bigint?: number | null
          subject_id?: string | null
          reporter_id?: string | null
          signal?: string
          severity?: number
          detail?: string | null
          state?: Database['public']['Enums']['flag_state']
          reviewer_id?: string | null
          created_at?: string
          reviewed_at?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      crisis_events: {
        Row: {
          id: number
          user_id: string
          ref_type: string | null
          ref_id: string | null
          ref_bigint: number | null
          risk: Database['public']['Enums']['risk_level']
          resources_shown: string[]
          country_code: string | null
          human_reviewed: boolean
          reviewer_id: string | null
          outcome: string | null
          created_at: string
          attended_at: string | null
        }
        Insert: {
          user_id: string
          ref_type?: string | null
          ref_id?: string | null
          ref_bigint?: number | null
          risk: Database['public']['Enums']['risk_level']
          resources_shown?: string[]
          country_code?: string | null
          human_reviewed?: boolean
          reviewer_id?: string | null
          outcome?: string | null
          created_at?: string
          attended_at?: string | null
        }
        Update: {
          user_id?: string
          ref_type?: string | null
          ref_id?: string | null
          ref_bigint?: number | null
          risk?: Database['public']['Enums']['risk_level']
          resources_shown?: string[]
          country_code?: string | null
          human_reviewed?: boolean
          reviewer_id?: string | null
          outcome?: string | null
          created_at?: string
          attended_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'crisis_events_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      crystal_ledger: {
        Row: {
          id: number
          user_id: string
          delta: number
          reason: string
          source: string
          external_id: string | null
          raw_receipt: Json | null
          created_at: string
        }
        Insert: {
          user_id: string
          delta: number
          reason: string
          source?: string
          external_id?: string | null
          raw_receipt?: Json | null
          created_at?: string
        }
        Update: {
          user_id?: string
          delta?: number
          reason?: string
          source?: string
          external_id?: string | null
          raw_receipt?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'crystal_ledger_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      boosts: {
        Row: {
          id: string
          post_id: string
          user_id: string
          currency: Database['public']['Enums']['boost_currency']
          amount: number
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          post_id: string
          user_id: string
          currency: Database['public']['Enums']['boost_currency']
          amount: number
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          post_id?: string
          user_id?: string
          currency?: Database['public']['Enums']['boost_currency']
          amount?: number
          expires_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'boosts_post_id_fkey'
            columns: ['post_id']
            referencedRelation: 'posts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'boosts_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      gifts: {
        Row: {
          id: string
          sender_id: string
          recipient_id: string
          ref_type: string | null
          ref_id: string | null
          gift_kind: string
          cost_crystals: number
          fee_crystals: number
          net_crystals: number
          message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sender_id: string
          recipient_id: string
          ref_type?: string | null
          ref_id?: string | null
          gift_kind: string
          cost_crystals: number
          fee_crystals?: number
          net_crystals: number
          message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          sender_id?: string
          recipient_id?: string
          ref_type?: string | null
          ref_id?: string | null
          gift_kind?: string
          cost_crystals?: number
          fee_crystals?: number
          net_crystals?: number
          message?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'gifts_sender_id_fkey'
            columns: ['sender_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'gifts_recipient_id_fkey'
            columns: ['recipient_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rate_limits: {
        Row: { key: string; window_start: string; count: number }
        Insert: { key: string; window_start: string; count?: number }
        Update: { key?: string; window_start?: string; count?: number }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      award_karma: {
        Args: {
          p_user: string
          p_kind: string
          p_ref_type?: string | null
          p_ref_id?: string | null
          p_idem?: string | null
        }
        Returns: number
      }
      spend_karma: {
        Args: { p_user: string; p_amount: number; p_reason: string }
        Returns: boolean
      }
      spend_crystals: {
        Args: { p_user: string; p_amount: number; p_reason: string }
        Returns: boolean
      }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      compute_hot_score: {
        Args: { p_upvotes: number; p_replies: number; p_created: string }
        Returns: number
      }
      is_refuge_member: { Args: { p_refuge: string }; Returns: boolean }
      is_blocked_with: { Args: { p_other: string }; Returns: boolean }
      refuge_has_block: { Args: { p_refuge: string; p_user: string }; Returns: boolean }
      /** Única vía para leer los campos privados del propio perfil (CONTRATOS §2). */
      mi_perfil_privado: {
        Args: Record<PropertyKey, never>
        Returns: {
          karma_spendable: number
          crystals: number
          listen_credits: number
          listens_given: number
          posts_published: number
          daily_karma_earned: number
          banned_until: string | null
        }[]
      }
    }
    Enums: {
      post_kind: 'desahogo' | 'pregunta' | 'gratitud'
      risk_level: 'none' | 'low' | 'high' | 'critical'
      entry_state: 'active' | 'hidden' | 'removed'
      refuge_kind: 'duo' | 'circulo'
      content_state: 'pending' | 'approved' | 'rejected'
      flag_state: 'pending' | 'reviewing' | 'resolved' | 'dismissed'
      boost_currency: 'karma' | 'crystals'
    }
    CompositeTypes: Record<never, never>
  }
}

// ── Atajos de consumo ───────────────────────────────────────────────────────
// Azúcar para no escribir `Database['public']['Tables']['posts']['Row']` en cada
// archivo. No sustituyen a `Database`: son la misma fuente, con menos ruido.

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
