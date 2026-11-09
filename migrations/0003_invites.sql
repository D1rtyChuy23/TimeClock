-- Invitations: an admin invites an email address with a role. The invited person
-- opens the link, creates their account, and gets that role.

create table if not exists invites (
  id bigint generated always as identity primary key,
  email text not null,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  token text not null unique,
  invited_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

-- One open invitation per email address.
create unique index if not exists invites_open_email on invites (lower(email)) where accepted_at is null;
