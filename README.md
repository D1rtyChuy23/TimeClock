# Team Time Clock

Clock in/out, weekly hours, PTO requests and company holidays, in English or Spanish.

Live app: https://d1rtychuy23.github.io/TimeClock/

Tests: `python3 test/run.py` (see HANDOFF.md, section 5.4).

Backend: Supabase project `team-time-clock` (sign-in and data). The key in `index.html` is the public publishable key; access is enforced by database row-level security.
