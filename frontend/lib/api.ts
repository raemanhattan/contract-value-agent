const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface LeaderboardPlayer {
  player: string;
  position: string;
  team: string;
  signing_season: number;
  age_at_signing: number;
  actual_cap_pct: number;
  predicted_cap_pct: number;
  pred_lower: number;
  pred_upper: number;
  pay_vs_production_ratio: number;
  team_is_overpaying: boolean;
  trailing_fantasy_points_ppr: number;
  trailing_games: number;
  low_confidence: boolean;
}

export interface LeaderboardResponse {
  position_filter: string | null;
  sort: "best_value" | "biggest_overpay";
  count: number;
  players: LeaderboardPlayer[];
}

export interface AskToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface AskResponse {
  answer: string;
  tool_calls: AskToolCall[];
}

export interface ContractDetail {
  found: boolean;
  player: string;
  contract?: {
    position: string;
    team: string;
    age_at_signing: number;
    start_year: number;
    end_year: number;
    length_years: number;
    total_value: number;
    average_salary: number;
  };
  current_cap_hit?: {
    team: string;
    season: number;
    roster_section: string;
    cap_hit: number;
    cap_hit_pct: number;
  };
}

export interface SurplusDetail {
  found: boolean;
  player: string;
  position?: string;
  signing_season?: number;
  age_at_signing?: number;
  trailing_production?: { fantasy_points_ppr: number; games: number };
  actual_cap_pct_at_signing?: number;
  model_predicted_cap_pct?: number;
  prediction_interval_90pct?: [number, number];
  pay_vs_production_ratio?: number;
  team_is_overpaying?: boolean;
  interpretation?: string;
  low_confidence?: boolean;
  low_confidence_note?: string | null;
  note?: string;
}

export interface StatsDetail {
  found: boolean;
  player: string;
  season?: number;
  games?: number;
  passing?: { completions: number; attempts: number; yards: number; tds: number };
  rushing?: { carries: number; yards: number; tds: number };
  receiving?: { receptions: number; targets: number; yards: number; tds: number };
  fantasy_points_ppr?: number;
  note?: string;
}

export interface SeasonStatsRow {
  season: number;
  games: number;
  passing_yards: number;
  passing_tds: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fantasy_points_ppr: number;
}

export interface PlayerDetailResponse {
  player: string;
  contract: ContractDetail;
  surplus: SurplusDetail;
  stats: StatsDetail;
  stats_history: SeasonStatsRow[];
}

export class ApiNotFoundError extends Error {}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new ApiNotFoundError("not found");
    }
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function fetchLeaderboard(params: {
  position?: string;
  sort?: "best_value" | "biggest_overpay";
  limit?: number;
}): Promise<LeaderboardResponse> {
  const query = new URLSearchParams();
  if (params.position) query.set("position", params.position);
  if (params.sort) query.set("sort", params.sort);
  if (params.limit) query.set("limit", String(params.limit));
  return apiFetch(`/api/leaderboard?${query.toString()}`);
}

export function askAgent(question: string): Promise<AskResponse> {
  return apiFetch("/api/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export function fetchPlayerDetail(name: string): Promise<PlayerDetailResponse> {
  return apiFetch(`/api/player/${encodeURIComponent(name)}`);
}

export interface ScatterPoint {
  player: string;
  trailing_fantasy_points_ppr: number;
  actual_cap_pct: number;
  age_at_signing: number;
  signing_season: number;
  team_is_overpaying: boolean;
  low_confidence: boolean;
}

export interface ScatterCurvePoint {
  trailing_fantasy_points_ppr: number;
  predicted_cap_pct: number;
}

export interface ScatterResponse {
  position: string;
  median_age_at_signing: number;
  points: ScatterPoint[];
  fitted_curve: ScatterCurvePoint[];
}

export function fetchScatter(position: string): Promise<ScatterResponse> {
  return apiFetch(`/api/scatter/${position}`);
}

export interface ModelInfo {
  formula: string;
  r_squared: number;
  training_sample_size: number;
  training_sample_by_position: Record<string, number>;
  total_contracts_in_dataset: number;
  contracts_not_yet_priced: number;
  coefficients: Record<string, { estimate: number; p_value: number }>;
}

export function fetchModelInfo(): Promise<ModelInfo> {
  return apiFetch("/api/model-info");
}
