"""NFL salary cap by season. Public, widely-published league data (the cap
figure is announced by the NFL/NFLPA each year) -- not sourced from any
site whose ToS restricts use.

Used to normalize a contract's average salary (APY) into a cap-hit
percentage AT THE TIME IT WAS SIGNED, which is what the point-in-time
market model needs. The 2026 figure was independently cross-validated
against our own parsed Spotrac cap_hit / cap_hit_pct data (implied cap
consistently ~$301.2M across sampled rows).
"""

from __future__ import annotations

NFL_SALARY_CAP_BY_YEAR: dict[int, int] = {
    2015: 143280000,
    2016: 155270000,
    2017: 167000000,
    2018: 177200000,
    2019: 188200000,
    2020: 198200000,
    2021: 182500000,  # COVID-19 revenue shortfall
    2022: 208200000,
    2023: 224800000,
    2024: 255400000,
    2025: 279200000,
    2026: 301200000,
}
