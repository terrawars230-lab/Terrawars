/**
 * Database types for the Supabase schema in `supabase/migrations/`.
 *
 * ⚠️ REGENERATE, DO NOT HAND-EDIT, after any migration:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public \
 *     > src/core/api/supabase/database.types.ts
 *
 * Committed rather than generated at build time so a checkout typechecks
 * without database credentials, and so a schema change shows up as a reviewable
 * diff instead of a surprise at runtime.
 *
 * PostGIS `geometry` columns arrive as GeoJSON when selected through the
 * `st_asgeojson` helpers in `fn_queries.sql`, and as an opaque WKB string
 * otherwise — hence `unknown` on the raw columns. Read geometry through the
 * RPC functions, never straight off a table.
 */

export type Json = string | number | boolean | null | {[key: string]: Json | undefined} | Json[];

export type WalkStatus = 'active' | 'completed' | 'abandoned' | 'rejected';
export type ClaimStatus = 'accepted' | 'rejected';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          color_hex: string;
          color_changed_at: string | null;
          home_city: string | null;
          home_region: string | null;
          is_under_review: boolean;
          is_shadow_suspended: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          color_hex?: string;
          home_city?: string | null;
          home_region?: string | null;
        };
        Update: {
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          home_city?: string | null;
          home_region?: string | null;
        };
        Relationships: [];
      };

      user_stats: {
        Row: {
          user_id: string;
          total_area_m2: number;
          parcels_count: number;
          total_distance_m: number;
          walks_count: number;
          claims_count: number;
          area_stolen_m2: number;
          area_lost_m2: number;
          steals_made: number;
          best_claim_m2: number;
          last_walk_at: string | null;
          updated_at: string;
        };
        Insert: {user_id: string};
        Update: never;
        Relationships: [];
      };

      walks: {
        Row: {
          id: string;
          user_id: string;
          client_walk_id: string | null;
          status: WalkStatus;
          started_at: string;
          ended_at: string | null;
          duration_s: number | null;
          distance_m: number | null;
          avg_speed_mps: number | null;
          max_speed_mps: number | null;
          point_count: number | null;
          /** Owner-visible only. Never render another user's path (doc 06 §4.1). */
          path: unknown | null;
          device_meta: Json;
          integrity: Json;
          reject_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_walk_id?: string | null;
          started_at: string;
          device_meta?: Json;
          integrity?: Json;
        };
        Update: {
          status?: WalkStatus;
          ended_at?: string | null;
          integrity?: Json;
        };
        Relationships: [];
      };

      walk_points: {
        Row: {
          walk_id: string;
          seq: number;
          ts: string;
          lat: number;
          lng: number;
          accuracy_m: number | null;
          speed_mps: number | null;
          altitude_m: number | null;
          heading: number | null;
          is_mock: boolean;
        };
        Insert: {
          walk_id: string;
          seq: number;
          ts: string;
          lat: number;
          lng: number;
          accuracy_m?: number | null;
          speed_mps?: number | null;
          altitude_m?: number | null;
          heading?: number | null;
          is_mock?: boolean;
        };
        Update: never;
        Relationships: [];
      };

      claims: {
        Row: {
          id: string;
          walk_id: string;
          user_id: string;
          status: ClaimStatus;
          error_code: string | null;
          geom: unknown | null;
          raw_area_m2: number | null;
          net_area_gain_m2: number | null;
          stolen_area_m2: number;
          perimeter_m: number | null;
          idempotency_key: string | null;
          created_at: string;
        };
        /** Written only by finish_walk. There is no client write policy. */
        Insert: never;
        Update: never;
        Relationships: [];
      };

      parcels: {
        Row: {
          id: string;
          owner_id: string;
          geom: unknown;
          area_m2: number;
          centroid: unknown;
          origin_claim_id: string | null;
          claimed_at: string;
          protected_until: string | null;
          updated_at: string;
        };
        /** Written only by finish_walk. A client insert here would end the game. */
        Insert: never;
        Update: never;
        Relationships: [];
      };

      steal_events: {
        Row: {
          id: string;
          claim_id: string;
          attacker_id: string;
          victim_id: string;
          area_m2: number;
          geom: unknown | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      weekly_scores: {
        Row: {
          user_id: string;
          iso_year: number;
          iso_week: number;
          area_gained_m2: number;
          distance_m: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      push_tokens: {
        Row: {
          token: string;
          user_id: string;
          platform: 'android' | 'ios';
          prefs: Json;
          updated_at: string;
        };
        Insert: {
          token: string;
          user_id: string;
          platform: 'android' | 'ios';
          prefs?: Json;
        };
        Update: {prefs?: Json};
        Relationships: [];
      };

      game_config: {
        Row: {
          key: string;
          value: Json;
          description: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      moderation_flags: {
        Row: {
          id: string;
          user_id: string;
          walk_id: string | null;
          reason: string;
          severity: number;
          details: Json;
          resolved: boolean;
          created_at: string;
        };
        /** No RLS policy at all — doc 06 §3, never readable by a client. */
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };

    Views: Record<string, never>;

    Functions: {
      finish_walk: {
        Args: {
          p_walk_id: string;
          p_idempotency_key?: string | null;
          p_ended_at?: string | null;
          p_attempt_claim?: boolean;
        };
        Returns: Json;
      };
      parcels_in_bbox: {
        Args: {
          p_min_lng: number;
          p_min_lat: number;
          p_max_lng: number;
          p_max_lat: number;
          p_zoom: number;
          p_limit?: number;
        };
        Returns: Json;
      };
      parcel_detail: {Args: {p_parcel_id: string}; Returns: Json};
      leaderboard_global: {Args: {p_limit?: number; p_offset?: number}; Returns: Json};
      leaderboard_weekly: {Args: {p_limit?: number; p_offset?: number}; Returns: Json};
      leaderboard_local: {Args: {p_city: string; p_limit?: number}; Returns: Json};
      get_me: {Args: Record<string, never>; Returns: Json};
      get_public_profile: {Args: {p_username: string}; Returns: Json};
      is_username_available: {Args: {p_username: string}; Returns: boolean};
      update_my_color: {Args: {p_color_hex: string}; Returns: Json};
      request_account_deletion: {Args: Record<string, never>; Returns: Json};
      user_global_rank: {Args: {p_user_id: string}; Returns: number};
    };

    Enums: {
      walk_status: WalkStatus;
      claim_status: ClaimStatus;
    };

    CompositeTypes: Record<string, never>;
  };
}

/** Convenience aliases so features do not repeat the deep index type. */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export type RpcName = keyof Database['public']['Functions'];
