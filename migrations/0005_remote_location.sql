-- Remote workers: an admin marks a person as remote, and their clock in / clock out
-- saves where they were at that moment (never in between). If the device couldn't
-- give a location, *_loc_miss says why (denied, unavailable, timeout, unsupported).
alter table profiles add column if not exists remote boolean not null default false;
alter table punches
  add column if not exists in_lat double precision,
  add column if not exists in_lng double precision,
  add column if not exists in_acc integer,
  add column if not exists in_loc_miss text,
  add column if not exists out_lat double precision,
  add column if not exists out_lng double precision,
  add column if not exists out_acc integer,
  add column if not exists out_loc_miss text;
