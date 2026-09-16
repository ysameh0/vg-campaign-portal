-- 0001_init.sql originally created campaigns_brand_external_id_key as a
-- partial unique index (`where external_id is not null`). ON CONFLICT can't
-- infer a partial index without repeating its predicate, which
-- supabase-js's upsert(onConflict: "brand_id,external_id") doesn't do, so
-- every campaigns import failed with "no unique or exclusion constraint
-- matching the ON CONFLICT specification". A plain unique constraint works
-- for both cases: Postgres already treats each NULL external_id (every
-- app-created campaign) as distinct from every other NULL, so app campaigns
-- never collide with each other or with seeded ones.
drop index if exists campaigns_brand_external_id_key;

alter table campaigns add constraint campaigns_brand_external_id_key
  unique (brand_id, external_id);
