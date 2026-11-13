-- Punches tapped while the device had no internet. They are sent later with the
-- time they were tapped; `late` marks them so the pay report lists them for review.
alter table punches add column if not exists late boolean not null default false;
