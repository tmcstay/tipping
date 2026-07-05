export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ad_placements: {
        Row: {
          active: boolean
          app_id: string
          config: Json | null
          created_at: string
          id: string
          placement_key: string
          provider: string
        }
        Insert: {
          active?: boolean
          app_id: string
          config?: Json | null
          created_at?: string
          id?: string
          placement_key: string
          provider: string
        }
        Update: {
          active?: boolean
          app_id?: string
          config?: Json | null
          created_at?: string
          id?: string
          placement_key?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_placements_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      apps: {
        Row: {
          ads_enabled: boolean
          code: string
          created_at: string
          dummy_activity_enabled: boolean
          grandtour_tipping_enabled: boolean
          id: string
          is_active: boolean
          name: string
          prizes_enabled: boolean
          sport: string
          subscriptions_enabled: boolean
          theme: Json | null
        }
        Insert: {
          ads_enabled?: boolean
          code: string
          created_at?: string
          dummy_activity_enabled?: boolean
          grandtour_tipping_enabled?: boolean
          id?: string
          is_active?: boolean
          name: string
          prizes_enabled?: boolean
          sport: string
          subscriptions_enabled?: boolean
          theme?: Json | null
        }
        Update: {
          ads_enabled?: boolean
          code?: string
          created_at?: string
          dummy_activity_enabled?: boolean
          grandtour_tipping_enabled?: boolean
          id?: string
          is_active?: boolean
          name?: string
          prizes_enabled?: boolean
          sport?: string
          subscriptions_enabled?: boolean
          theme?: Json | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          body: string
          chat_zone_id: string
          created_at: string
          id: string
          is_dummy: boolean
          is_sponsored: boolean
          is_system: boolean
          moderation_status: string
          user_id: string
        }
        Insert: {
          body: string
          chat_zone_id: string
          created_at?: string
          id?: string
          is_dummy?: boolean
          is_sponsored?: boolean
          is_system?: boolean
          moderation_status?: string
          user_id: string
        }
        Update: {
          body?: string
          chat_zone_id?: string
          created_at?: string
          id?: string
          is_dummy?: boolean
          is_sponsored?: boolean
          is_system?: boolean
          moderation_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_zone_id_fkey"
            columns: ["chat_zone_id"]
            isOneToOne: false
            referencedRelation: "chat_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_zones: {
        Row: {
          app_id: string
          competition_id: string | null
          created_at: string
          id: string
          name: string
          season_id: string | null
        }
        Insert: {
          app_id: string
          competition_id?: string | null
          created_at?: string
          id?: string
          name: string
          season_id?: string | null
        }
        Update: {
          app_id?: string
          competition_id?: string | null
          created_at?: string
          id?: string
          name?: string
          season_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_zones_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_zones_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_zones_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_memberships: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: string
          status?: string
          user_id: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_memberships_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          app_id: string
          competition_key: string
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          season: string | null
          sport_type: string
          starts_at: string | null
        }
        Insert: {
          app_id: string
          competition_key: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          name: string
          season?: string | null
          sport_type: string
          starts_at?: string | null
        }
        Update: {
          app_id?: string
          competition_key?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          season?: string | null
          sport_type?: string
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          active: boolean
          competition_id: string
          competitor_key: string
          competitor_type: string
          created_at: string
          id: string
          name: string
          team_name: string | null
        }
        Insert: {
          active?: boolean
          competition_id: string
          competitor_key: string
          competitor_type: string
          created_at?: string
          id?: string
          name: string
          team_name?: string | null
        }
        Update: {
          active?: boolean
          competition_id?: string
          competitor_key?: string
          competitor_type?: string
          created_at?: string
          id?: string
          name?: string
          team_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      data_audit: {
        Row: {
          comments: string | null
          confidence_notes: string | null
          created_at: string
          data_confidence: string
          date_accessed: string
          fields_found: string[]
          grand_tour_id: string | null
          id: string
          missing_fields: string[]
          reuse_risk: string
          source_name: string
          source_url: string
          updated_at: string
        }
        Insert: {
          comments?: string | null
          confidence_notes?: string | null
          created_at?: string
          data_confidence?: string
          date_accessed: string
          fields_found?: string[]
          grand_tour_id?: string | null
          id?: string
          missing_fields?: string[]
          reuse_risk?: string
          source_name: string
          source_url: string
          updated_at?: string
        }
        Update: {
          comments?: string | null
          confidence_notes?: string | null
          created_at?: string
          data_confidence?: string
          date_accessed?: string
          fields_found?: string[]
          grand_tour_id?: string | null
          id?: string
          missing_fields?: string[]
          reuse_risk?: string
          source_name?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_audit_grand_tour_id_fkey"
            columns: ["grand_tour_id"]
            isOneToOne: false
            referencedRelation: "grand_tours"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          country: string | null
          created_at: string
          event_key: string
          id: string
          lock_at: string | null
          name: string
          season_id: string
          starts_at: string | null
          status: string
          venue: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          event_key: string
          id?: string
          lock_at?: string | null
          name: string
          season_id: string
          starts_at?: string | null
          status?: string
          venue?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          event_key?: string
          id?: string
          lock_at?: string | null
          name?: string
          season_id?: string
          starts_at?: string | null
          status?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      grand_tours: {
        Row: {
          category: string | null
          countries: string[]
          created_at: string
          data_confidence: string
          ends_at: string | null
          id: string
          manual_lock_reason: string | null
          manual_locked_at: string | null
          manual_locked_by: string | null
          name: string
          preselection_locks_at: string
          source_url: string | null
          sport: string
          starts_at: string | null
          updated_at: string
          year: number
        }
        Insert: {
          category?: string | null
          countries?: string[]
          created_at?: string
          data_confidence?: string
          ends_at?: string | null
          id?: string
          manual_lock_reason?: string | null
          manual_locked_at?: string | null
          manual_locked_by?: string | null
          name: string
          preselection_locks_at: string
          source_url?: string | null
          sport?: string
          starts_at?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          category?: string | null
          countries?: string[]
          created_at?: string
          data_confidence?: string
          ends_at?: string | null
          id?: string
          manual_lock_reason?: string | null
          manual_locked_at?: string | null
          manual_locked_by?: string | null
          name?: string
          preselection_locks_at?: string
          source_url?: string | null
          sport?: string
          starts_at?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "grand_tours_manual_locked_by_fkey"
            columns: ["manual_locked_by"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grand_tours_manual_locked_by_fkey"
            columns: ["manual_locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_competitions: {
        Row: {
          active_jersey_types: Database["public"]["Enums"]["grandtour_jersey_type"][]
          allow_daily: boolean
          allow_preselection: boolean
          competition_id: string
          created_at: string
          grand_tour_id: string
          id: string
          is_public: boolean
          name: string
        }
        Insert: {
          active_jersey_types?: Database["public"]["Enums"]["grandtour_jersey_type"][]
          allow_daily?: boolean
          allow_preselection?: boolean
          competition_id: string
          created_at?: string
          grand_tour_id: string
          id?: string
          is_public?: boolean
          name: string
        }
        Update: {
          active_jersey_types?: Database["public"]["Enums"]["grandtour_jersey_type"][]
          allow_daily?: boolean
          allow_preselection?: boolean
          competition_id?: string
          created_at?: string
          grand_tour_id?: string
          id?: string
          is_public?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_competitions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: true
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_competitions_grand_tour_id_fkey"
            columns: ["grand_tour_id"]
            isOneToOne: false
            referencedRelation: "grand_tours"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_game_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          competition_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_value: Json | null
          old_value: Json | null
          reason: string | null
          request_id: string | null
          stage_id: string | null
          tip_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          competition_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          request_id?: string | null
          stage_id?: string | null
          tip_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          competition_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          reason?: string | null
          request_id?: string | null
          stage_id?: string | null
          tip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_game_audit_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "grandtour_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_game_audit_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_leaderboard_snapshots: {
        Row: {
          competition_id: string
          id: string
          is_dummy: boolean
          is_prize_eligible: boolean
          last_stage_score: number | null
          leaderboard_type: string
          rank: number
          snapshot_at: string
          stages_tipped: number
          total_score: number
          user_id: string
        }
        Insert: {
          competition_id: string
          id?: string
          is_dummy?: boolean
          is_prize_eligible?: boolean
          last_stage_score?: number | null
          leaderboard_type: string
          rank: number
          snapshot_at?: string
          stages_tipped?: number
          total_score?: number
          user_id: string
        }
        Update: {
          competition_id?: string
          id?: string
          is_dummy?: boolean
          is_prize_eligible?: boolean
          last_stage_score?: number | null
          leaderboard_type?: string
          rank?: number
          snapshot_at?: string
          stages_tipped?: number
          total_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_leaderboard_snapshots_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "grandtour_competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_riders: {
        Row: {
          bib_number: number | null
          country: string | null
          created_at: string
          data_confidence: string
          date_of_birth: string | null
          display_name: string
          grand_tour_id: string
          id: string
          is_active: boolean
          nationality: string | null
          normalized_name: string
          rider_type: string | null
          source_url: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          bib_number?: number | null
          country?: string | null
          created_at?: string
          data_confidence?: string
          date_of_birth?: string | null
          display_name: string
          grand_tour_id: string
          id?: string
          is_active?: boolean
          nationality?: string | null
          normalized_name: string
          rider_type?: string | null
          source_url?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          bib_number?: number | null
          country?: string | null
          created_at?: string
          data_confidence?: string
          date_of_birth?: string | null
          display_name?: string
          grand_tour_id?: string
          id?: string
          is_active?: boolean
          nationality?: string | null
          normalized_name?: string
          rider_type?: string | null
          source_url?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_riders_grand_tour_id_fkey"
            columns: ["grand_tour_id"]
            isOneToOne: false
            referencedRelation: "grand_tours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_riders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "grandtour_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_stage_jersey_holders: {
        Row: {
          created_at: string
          id: string
          jersey_type: Database["public"]["Enums"]["grandtour_jersey_type"]
          rider_id: string
          stage_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          jersey_type: Database["public"]["Enums"]["grandtour_jersey_type"]
          rider_id: string
          stage_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          jersey_type?: Database["public"]["Enums"]["grandtour_jersey_type"]
          rider_id?: string
          stage_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stage_jersey_holders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "grandtour_riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_jersey_holders_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_stage_result_lines: {
        Row: {
          actual_position: number
          created_at: string
          id: string
          rider_id: string
          stage_result_id: string
        }
        Insert: {
          actual_position: number
          created_at?: string
          id?: string
          rider_id: string
          stage_result_id: string
        }
        Update: {
          actual_position?: number
          created_at?: string
          id?: string
          rider_id?: string
          stage_result_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stage_result_lines_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "grandtour_riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_result_lines_stage_result_id_fkey"
            columns: ["stage_result_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stage_results"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_stage_results: {
        Row: {
          created_at: string
          id: string
          is_final: boolean
          stage_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_final?: boolean
          stage_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_final?: boolean
          stage_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stage_results_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: true
            referencedRelation: "grandtour_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_stage_scores: {
        Row: {
          bonus_score: number
          competition_id: string
          id: string
          is_prize_eligible: boolean
          jersey_score: number
          score_details: Json
          scored_at: string
          stage_id: string
          tip_id: string
          tip_mode: Database["public"]["Enums"]["grandtour_tip_mode"]
          tip_scope: Database["public"]["Enums"]["grandtour_tip_scope"]
          top5_score: number
          total_score: number
          user_id: string
        }
        Insert: {
          bonus_score?: number
          competition_id: string
          id?: string
          is_prize_eligible?: boolean
          jersey_score?: number
          score_details?: Json
          scored_at?: string
          stage_id: string
          tip_id: string
          tip_mode: Database["public"]["Enums"]["grandtour_tip_mode"]
          tip_scope?: Database["public"]["Enums"]["grandtour_tip_scope"]
          top5_score?: number
          total_score?: number
          user_id: string
        }
        Update: {
          bonus_score?: number
          competition_id?: string
          id?: string
          is_prize_eligible?: boolean
          jersey_score?: number
          score_details?: Json
          scored_at?: string
          stage_id?: string
          tip_id?: string
          tip_mode?: Database["public"]["Enums"]["grandtour_tip_mode"]
          tip_scope?: Database["public"]["Enums"]["grandtour_tip_scope"]
          top5_score?: number
          total_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stage_scores_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "grandtour_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_scores_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_scores_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: true
            referencedRelation: "grandtour_tips"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_stage_startlists: {
        Row: {
          bib_number: number | null
          created_at: string
          data_confidence: string
          id: string
          rider_id: string
          rider_role: string | null
          source_url: string | null
          stage_id: string
          status: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          bib_number?: number | null
          created_at?: string
          data_confidence?: string
          id?: string
          rider_id: string
          rider_role?: string | null
          source_url?: string | null
          stage_id: string
          status?: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          bib_number?: number | null
          created_at?: string
          data_confidence?: string
          id?: string
          rider_id?: string
          rider_role?: string | null
          source_url?: string | null
          stage_id?: string
          status?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stage_startlists_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "grandtour_riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_startlists_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_startlists_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "grandtour_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_stage_team_result_lines: {
        Row: {
          actual_position: number
          created_at: string
          id: string
          stage_result_id: string
          team_id: string
        }
        Insert: {
          actual_position: number
          created_at?: string
          id?: string
          stage_result_id: string
          team_id: string
        }
        Update: {
          actual_position?: number
          created_at?: string
          id?: string
          stage_result_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stage_team_result_lines_stage_result_id_fkey"
            columns: ["stage_result_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stage_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_team_result_lines_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "grandtour_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_stages: {
        Row: {
          created_at: string
          data_confidence: string
          distance_km: number | null
          finish_location: string | null
          grand_tour_id: string
          id: string
          locks_at: string
          manual_lock_reason: string | null
          manual_locked_at: string | null
          manual_locked_by: string | null
          source_url: string | null
          stage_name: string | null
          stage_number: number
          stage_type: Database["public"]["Enums"]["grandtour_stage_type"]
          start_location: string | null
          start_time_is_estimated: boolean
          starts_at: string
          ttt_timing_rule:
            | Database["public"]["Enums"]["grandtour_ttt_timing_rule"]
            | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_confidence?: string
          distance_km?: number | null
          finish_location?: string | null
          grand_tour_id: string
          id?: string
          locks_at: string
          manual_lock_reason?: string | null
          manual_locked_at?: string | null
          manual_locked_by?: string | null
          source_url?: string | null
          stage_name?: string | null
          stage_number: number
          stage_type: Database["public"]["Enums"]["grandtour_stage_type"]
          start_location?: string | null
          start_time_is_estimated?: boolean
          starts_at: string
          ttt_timing_rule?:
            | Database["public"]["Enums"]["grandtour_ttt_timing_rule"]
            | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_confidence?: string
          distance_km?: number | null
          finish_location?: string | null
          grand_tour_id?: string
          id?: string
          locks_at?: string
          manual_lock_reason?: string | null
          manual_locked_at?: string | null
          manual_locked_by?: string | null
          source_url?: string | null
          stage_name?: string | null
          stage_number?: number
          stage_type?: Database["public"]["Enums"]["grandtour_stage_type"]
          start_location?: string | null
          start_time_is_estimated?: boolean
          starts_at?: string
          ttt_timing_rule?:
            | Database["public"]["Enums"]["grandtour_ttt_timing_rule"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stages_grand_tour_id_fkey"
            columns: ["grand_tour_id"]
            isOneToOne: false
            referencedRelation: "grand_tours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stages_manual_locked_by_fkey"
            columns: ["manual_locked_by"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stages_manual_locked_by_fkey"
            columns: ["manual_locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_teams: {
        Row: {
          code: string | null
          country: string | null
          created_at: string
          data_confidence: string
          grand_tour_id: string
          id: string
          name: string
          short_name: string | null
          source_url: string | null
          team_type: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          country?: string | null
          created_at?: string
          data_confidence?: string
          grand_tour_id: string
          id?: string
          name: string
          short_name?: string | null
          source_url?: string | null
          team_type?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          country?: string | null
          created_at?: string
          data_confidence?: string
          grand_tour_id?: string
          id?: string
          name?: string
          short_name?: string | null
          source_url?: string | null
          team_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_teams_grand_tour_id_fkey"
            columns: ["grand_tour_id"]
            isOneToOne: false
            referencedRelation: "grand_tours"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_tip_selections: {
        Row: {
          created_at: string
          id: string
          predicted_position: number | null
          rider_id: string | null
          selection_type: Database["public"]["Enums"]["grandtour_tip_selection_type"]
          team_id: string | null
          tip_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          predicted_position?: number | null
          rider_id?: string | null
          selection_type: Database["public"]["Enums"]["grandtour_tip_selection_type"]
          team_id?: string | null
          tip_id: string
        }
        Update: {
          created_at?: string
          id?: string
          predicted_position?: number | null
          rider_id?: string | null
          selection_type?: Database["public"]["Enums"]["grandtour_tip_selection_type"]
          team_id?: string | null
          tip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_tip_selections_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "grandtour_riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_tip_selections_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "grandtour_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_tip_selections_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: false
            referencedRelation: "grandtour_tips"
            referencedColumns: ["id"]
          },
        ]
      }
      grandtour_tips: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          is_dummy: boolean
          locked_at: string | null
          stage_id: string | null
          status: Database["public"]["Enums"]["grandtour_tip_status"]
          submitted_at: string | null
          tip_mode: Database["public"]["Enums"]["grandtour_tip_mode"]
          tip_scope: Database["public"]["Enums"]["grandtour_tip_scope"]
          total_score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          is_dummy?: boolean
          locked_at?: string | null
          stage_id?: string | null
          status?: Database["public"]["Enums"]["grandtour_tip_status"]
          submitted_at?: string | null
          tip_mode: Database["public"]["Enums"]["grandtour_tip_mode"]
          tip_scope?: Database["public"]["Enums"]["grandtour_tip_scope"]
          total_score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          is_dummy?: boolean
          locked_at?: string | null
          stage_id?: string | null
          status?: Database["public"]["Enums"]["grandtour_tip_status"]
          submitted_at?: string | null
          tip_mode?: Database["public"]["Enums"]["grandtour_tip_mode"]
          tip_scope?: Database["public"]["Enums"]["grandtour_tip_scope"]
          total_score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_tips_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "grandtour_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_tips_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboards: {
        Row: {
          app_id: string
          created_at: string
          id: string
          rank: number | null
          season_id: string
          tips_count: number
          total_points: number
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: string
          rank?: number | null
          season_id: string
          tips_count?: number
          total_points?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: string
          rank?: number | null
          season_id?: string
          tips_count?: number
          total_points?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboards_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboards_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          created_at: string
          event_id: string
          id: string
          lock_at: string | null
          market_key: string
          market_type: string
          name: string
          points_rule: Json
          status: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          lock_at?: string | null
          market_key: string
          market_type: string
          name: string
          points_rule: Json
          status?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          lock_at?: string | null
          market_key?: string
          market_type?: string
          name?: string
          points_rule?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "markets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          is_admin: boolean
          is_dummy: boolean
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          is_admin?: boolean
          is_dummy?: boolean
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          is_admin?: boolean
          is_dummy?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      results: {
        Row: {
          competitor_id: string
          created_at: string
          id: string
          market_id: string
          points_awarded: number | null
          position: number | null
          result_status: string
        }
        Insert: {
          competitor_id: string
          created_at?: string
          id?: string
          market_id: string
          points_awarded?: number | null
          position?: number | null
          result_status?: string
        }
        Update: {
          competitor_id?: string
          created_at?: string
          id?: string
          market_id?: string
          points_awarded?: number | null
          position?: number | null
          result_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "results_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          name: string
          season_year: number
          status: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          name: string
          season_year: number
          status?: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          name?: string
          season_year?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          entitlement: string
          id: string
          provider: string
          provider_customer_id: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          entitlement: string
          id?: string
          provider: string
          provider_customer_id?: string | null
          status: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          entitlement?: string
          id?: string
          provider?: string
          provider_customer_id?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_posts: {
        Row: {
          app_id: string
          body: string
          chat_zone_id: string | null
          created_at: string
          id: string
          is_sponsored: boolean
          post_type: string
          published_at: string | null
          scheduled_at: string | null
          title: string | null
        }
        Insert: {
          app_id: string
          body: string
          chat_zone_id?: string | null
          created_at?: string
          id?: string
          is_sponsored?: boolean
          post_type: string
          published_at?: string | null
          scheduled_at?: string | null
          title?: string | null
        }
        Update: {
          app_id?: string
          body?: string
          chat_zone_id?: string | null
          created_at?: string
          id?: string
          is_sponsored?: boolean
          post_type?: string
          published_at?: string | null
          scheduled_at?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_posts_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_posts_chat_zone_id_fkey"
            columns: ["chat_zone_id"]
            isOneToOne: false
            referencedRelation: "chat_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      tips: {
        Row: {
          competitor_id: string
          created_at: string
          id: string
          is_dummy: boolean
          market_id: string
          submitted_at: string
          user_id: string
        }
        Insert: {
          competitor_id: string
          created_at?: string
          id?: string
          is_dummy?: boolean
          market_id: string
          submitted_at?: string
          user_id: string
        }
        Update: {
          competitor_id?: string
          created_at?: string
          id?: string
          is_dummy?: boolean
          market_id?: string
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tips_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_app_memberships: {
        Row: {
          app_id: string
          created_at: string
          id: string
          role: string
          status: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: string
          role?: string
          status?: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: string
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_app_memberships_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_app_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "grandtour_league_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_app_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      grandtour_league_profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string | null
          is_dummy: boolean | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
          is_dummy?: boolean | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string | null
          is_dummy?: boolean | null
        }
        Relationships: []
      }
      grandtour_prize_eligible_scores: {
        Row: {
          bonus_score: number | null
          competition_id: string | null
          id: string | null
          is_prize_eligible: boolean | null
          jersey_score: number | null
          score_details: Json | null
          scored_at: string | null
          stage_id: string | null
          tip_id: string | null
          tip_mode: Database["public"]["Enums"]["grandtour_tip_mode"] | null
          tip_scope: Database["public"]["Enums"]["grandtour_tip_scope"] | null
          top5_score: number | null
          total_score: number | null
          user_id: string | null
        }
        Insert: {
          bonus_score?: number | null
          competition_id?: string | null
          id?: string | null
          is_prize_eligible?: boolean | null
          jersey_score?: number | null
          score_details?: Json | null
          scored_at?: string | null
          stage_id?: string | null
          tip_id?: string | null
          tip_mode?: Database["public"]["Enums"]["grandtour_tip_mode"] | null
          tip_scope?: Database["public"]["Enums"]["grandtour_tip_scope"] | null
          top5_score?: number | null
          total_score?: number | null
          user_id?: string | null
        }
        Update: {
          bonus_score?: number | null
          competition_id?: string | null
          id?: string | null
          is_prize_eligible?: boolean | null
          jersey_score?: number | null
          score_details?: Json | null
          scored_at?: string | null
          stage_id?: string | null
          tip_id?: string | null
          tip_mode?: Database["public"]["Enums"]["grandtour_tip_mode"] | null
          tip_scope?: Database["public"]["Enums"]["grandtour_tip_scope"] | null
          top5_score?: number | null
          total_score?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grandtour_stage_scores_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "grandtour_competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_scores_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "grandtour_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grandtour_stage_scores_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: true
            referencedRelation: "grandtour_tips"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      clear_grandtour_tip_draft: {
        Args: { p_reason?: string; p_request_id?: string; p_tip_id: string }
        Returns: boolean
      }
      get_grandtour_leaderboard: {
        Args: { p_competition_id: string; p_leaderboard_type?: string }
        Returns: {
          display_name: string
          id: string
          is_dummy: boolean
          is_prize_eligible: boolean
          last_stage_score: number
          leaderboard_type: string
          rank: number
          snapshot_at: string
          stages_tipped: number
          total_score: number
          user_id: string
        }[]
      }
      lock_grandtour_stage_tips: {
        Args: { p_reason: string; p_request_id?: string; p_stage_id: string }
        Returns: number
      }
      recalculate_grandtour_stage_scores: {
        Args: { p_reason?: string; p_request_id?: string; p_stage_id: string }
        Returns: number
      }
      save_grandtour_tip_draft: {
        Args: {
          p_competition_id: string
          p_request_id?: string
          p_selections: Json
          p_stage_id: string
          p_tip_mode: Database["public"]["Enums"]["grandtour_tip_mode"]
          p_tip_scope: Database["public"]["Enums"]["grandtour_tip_scope"]
        }
        Returns: string
      }
      score_grandtour_stage: {
        Args: { p_request_id?: string; p_stage_id: string }
        Returns: number
      }
      submit_grandtour_tip: {
        Args: { p_request_id?: string; p_tip_id: string }
        Returns: {
          competition_id: string
          created_at: string
          id: string
          is_dummy: boolean
          locked_at: string | null
          stage_id: string | null
          status: Database["public"]["Enums"]["grandtour_tip_status"]
          submitted_at: string | null
          tip_mode: Database["public"]["Enums"]["grandtour_tip_mode"]
          tip_scope: Database["public"]["Enums"]["grandtour_tip_scope"]
          total_score: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "grandtour_tips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      grandtour_jersey_type: "yellow" | "green" | "kom" | "white"
      grandtour_stage_type:
        | "flat"
        | "hilly"
        | "mountain"
        | "individual_time_trial"
        | "team_time_trial"
        | "rest_day"
        | "road"
        | "itt"
        | "ttt"
        | "sprint"
      grandtour_tip_mode: "preselection" | "daily"
      grandtour_tip_scope: "stage" | "overall_jerseys"
      grandtour_tip_selection_type:
        | "stage_top_5"
        | "yellow_holder"
        | "green_holder"
        | "kom_holder"
        | "white_holder"
        | "overall_yellow_winner"
        | "overall_green_winner"
        | "overall_kom_winner"
        | "overall_white_winner"
      grandtour_tip_status:
        | "draft"
        | "submitted"
        | "locked"
        | "scored"
        | "voided"
        | "corrected"
        | "missed"
        | "deleted"
      grandtour_ttt_timing_rule: "team_time" | "individual_time"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      grandtour_jersey_type: ["yellow", "green", "kom", "white"],
      grandtour_stage_type: [
        "flat",
        "hilly",
        "mountain",
        "individual_time_trial",
        "team_time_trial",
        "rest_day",
        "road",
        "itt",
        "ttt",
        "sprint",
      ],
      grandtour_tip_mode: ["preselection", "daily"],
      grandtour_tip_scope: ["stage", "overall_jerseys"],
      grandtour_tip_selection_type: [
        "stage_top_5",
        "yellow_holder",
        "green_holder",
        "kom_holder",
        "white_holder",
        "overall_yellow_winner",
        "overall_green_winner",
        "overall_kom_winner",
        "overall_white_winner",
      ],
      grandtour_tip_status: [
        "draft",
        "submitted",
        "locked",
        "scored",
        "voided",
        "corrected",
        "missed",
        "deleted",
      ],
      grandtour_ttt_timing_rule: ["team_time", "individual_time"],
    },
  },
} as const
