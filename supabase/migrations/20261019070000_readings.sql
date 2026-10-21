-- Home readings in the health diary (DESIGN.md 8.6d, PLAN.md §12 "Research round 2"): blood pressure with pulse, blood
-- sugar with when it was taken, and weight. Additive only; the diary's owner-only, accounts-only rules apply unchanged.

alter table public.health_log
  add column bp_systolic smallint check (bp_systolic between 50 and 260),
  add column bp_diastolic smallint check (bp_diastolic between 30 and 160),
  add column pulse smallint check (pulse between 25 and 250),
  add column glucose_mgdl smallint check (glucose_mgdl between 20 and 700),
  add column glucose_timing text check (glucose_timing in ('fasting', 'after_meal', 'random')),
  add column weight_kg numeric(4, 1) check (weight_kg between 2 and 350),
  -- Blood pressure is both numbers or neither, the top one higher.
  add constraint health_log_bp_pair check ((bp_systolic is null) = (bp_diastolic is null) and (bp_systolic is null or bp_systolic > bp_diastolic)),
  -- When a sugar reading was taken only makes sense with the reading.
  add constraint health_log_glucose_timing_needs_reading check (glucose_timing is null or glucose_mgdl is not null);

-- An entry still has to say something; a reading on its own now counts.
alter table public.health_log drop constraint health_log_check;
alter table public.health_log add constraint health_log_says_something check (
  symptom is not null or severity is not null or temperature_c is not null or feeling is not null or note is not null
  or bp_systolic is not null or pulse is not null or glucose_mgdl is not null or weight_kg is not null
);
