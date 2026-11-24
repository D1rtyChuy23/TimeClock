-- Work sites and each person's clock-in rule (src/lib/work-sites.ts).
--   anywhere: no location (default)   remote: location saved   onsite: must be inside a work site
alter table profiles add column if not exists clock_rule text not null default 'anywhere'
  check (clock_rule in ('anywhere', 'remote', 'onsite'));
-- People marked "Remote worker" before this keep that.
update profiles set clock_rule = 'remote' where remote and clock_rule = 'anywhere';

create table if not exists work_sites (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 60),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null check (radius_m between 30 and 5000),
  created_at timestamptz not null default now()
);
