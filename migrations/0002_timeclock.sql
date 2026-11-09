-- Team time clock. user ids are text (Better Auth), not uuid.

create table if not exists profiles (
  user_id text primary key references "user" (id) on delete cascade,
  full_name text not null default '',
  email text,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  pto_allowance numeric(6,2) not null default 0 check (pto_allowance >= 0),
  created_at timestamptz not null default now()
);

create table if not exists punches (
  id bigint generated always as identity primary key,
  user_id text not null references profiles (user_id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  manual boolean not null default false,
  created_by text,
  check (clock_out is null or clock_out > clock_in)
);

create unique index if not exists one_open_punch on punches (user_id) where clock_out is null;
create index if not exists punches_user_in on punches (user_id, clock_in desc);

create table if not exists pto_requests (
  id bigint generated always as identity primary key,
  user_id text not null references profiles (user_id) on delete cascade,
  day date not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by text,
  created_at timestamptz not null default now()
);

create index if not exists pto_user on pto_requests (user_id);

create table if not exists holidays (
  day date primary key,
  name text not null check (char_length(name) between 1 and 60)
);
