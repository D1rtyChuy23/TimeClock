-- Access (clock-machine.ts, section 9). New accounts wait for an admin unless they came
-- with an invitation; an admin can turn off access for someone who left.
--   pending: signed up, waiting for approval. Sees nothing, can't clock in.
--   active:  normal use.
--   blocked: access turned off. Their past hours stay in reports.
alter table profiles add column if not exists access text;
-- Everyone who was already here keeps working.
update profiles set access = 'active' where access is null;
alter table profiles alter column access set default 'pending';
alter table profiles alter column access set not null;
do $$ begin
  alter table profiles add constraint profiles_access_check check (access in ('pending', 'active', 'blocked'));
exception when duplicate_object then null;
end $$;
