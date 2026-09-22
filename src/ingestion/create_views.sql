-- Views tying cap_hits (Spotrac, 2026 season) to rosters/seasonal_stats
-- (nfl_data_py) via player name. Exact-name matching currently resolves
-- ~82% of players; the rest are unmatched rookies/practice-squad players
-- not yet in nfl_data_py's roster snapshots, or genuine name-format
-- mismatches to be handled later (fuzzy matching, manual overrides).

-- One row per Spotrac player: their most recent known nfl_data_py
-- player_id, if any. "Most recent" breaks ties when a name appears in
-- multiple roster seasons (transfers, re-signings, etc.).
CREATE OR REPLACE VIEW player_crosswalk AS
SELECT
    ch.player,
    (
        SELECT r.player_id
        FROM rosters r
        WHERE r.player_name = ch.player
        ORDER BY r.season DESC
        LIMIT 1
    ) AS player_id
FROM (SELECT DISTINCT player FROM cap_hits) ch;

-- cap_hits enriched with player_id where a crosswalk match exists.
CREATE OR REPLACE VIEW cap_hits_enriched AS
SELECT
    ch.*,
    pc.player_id
FROM cap_hits ch
LEFT JOIN player_crosswalk pc ON ch.player = pc.player;
