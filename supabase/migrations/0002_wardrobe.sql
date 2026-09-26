-- The wardrobe itself, plus the RLS that makes "dedicated only to you" true at
-- the database rather than in app code.
--
-- Three footguns are closed here deliberately. Read the comments before
-- changing any policy.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- wardrobe_items
--
-- Typed columns and enums, not a JSONB attribute blob. The engine's hot query
-- is "every torso item with warmth >= 4 and layer_role = 'outer'", which wants
-- btree indexes, not a jsonb path scan. Typed columns also flow through
-- `supabase gen types typescript` as string-literal unions, so the engine gets
-- compile-time safety free.
-- ---------------------------------------------------------------------------

create table public.wardrobe_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  name        text,
  category    garment_category not null,
  subcategory text not null references public.garment_subcategory(code),

  body_zone       body_zone  not null,
  layer_role      layer_role not null,
  alt_layer_roles layer_role[] not null default '{}',

  warmth        smallint not null check (warmth        between 1 and 5),
  breathability smallint not null check (breathability between 1 and 5),
  bulk          smallint not null check (bulk          between 1 and 5),
  formality     smallint not null check (formality     between 1 and 5),

  silhouette silhouette     not null default 'straight',
  length     garment_length not null default 'n_a',
  rise       rise           not null default 'n_a',

  pattern       pattern       not null default 'solid',
  pattern_scale pattern_scale not null default 'none',
  materials     material[]    not null default '{}',
  sheen         sheen         not null default 'matte',

  -- Dominant colours in OKLCh, from cutout-masked pixels only.
  -- [{"l":0.42,"c":0.11,"h":258.4,"fraction":0.71}, ...]
  -- THE one attribute that cannot be backfilled: it needs the alpha mask, and
  -- clustering background pixels in makes every garment the colour of the floor.
  palette jsonb not null default '[]'::jsonb,

  -- Per-attribute confidence. Empty means the user asserted it by hand.
  -- The engine halves the weight of anything below 0.6 rather than vetoing on it.
  confidence jsonb not null default '{}'::jsonb,

  cover_image_id uuid,

  -- Columns M4 will write. Present now so no ALTER is needed later; nothing
  -- reads or mutates them in M1 or M2.
  last_worn_at timestamptz,
  times_worn   integer not null default 0,
  archived     boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The engine's actual access pattern.
create index wardrobe_items_user           on public.wardrobe_items (user_id) where not archived;
create index wardrobe_items_user_role      on public.wardrobe_items (user_id, layer_role, warmth);
create index wardrobe_items_user_updated   on public.wardrobe_items (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- item_images
--
-- Versioned: nothing is ever overwritten. Keeping the source and bumping
-- `version` on every reprocess means the whole pipeline can be re-run with a
-- better model or recalibrated thresholds without asking anyone to
-- re-photograph a single garment. This is the most important reversibility
-- decision in the design.
-- ---------------------------------------------------------------------------

create type render_mode  as enum ('cutout', 'stylized');
create type image_status as enum ('pending', 'processing', 'ready', 'rejected', 'failed');

create table public.item_images (
  id      uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.wardrobe_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  version     integer     not null default 1,
  render_mode render_mode not null default 'cutout',
  status      image_status not null default 'pending',

  -- wardrobe/{user_id}/{item_id}/v{n}/{source.jpg|tile.webp|thumb.webp}
  source_path text not null,
  tile_path   text,
  thumb_path  text,

  -- Quality, all null until processing finishes. Stored rather than discarded
  -- so "why is this tag wrong" is answerable later, and so thresholds can be
  -- refitted against real captures instead of guesses.
  score         smallint,
  issues        text[] not null default '{}',
  still_metrics jsonb,
  mask_metrics  jsonb,
  bbox          jsonb,
  -- Did the user keep it despite a warning? The calibration signal, logged
  -- here rather than in a table of its own.
  kept_despite_warning boolean,

  provider text,
  cost_usd numeric(8,5),
  error    text,

  created_at timestamptz not null default now()
);

create unique index item_images_version on public.item_images (item_id, render_mode, version);
create index item_images_item on public.item_images (item_id);

alter table public.wardrobe_items
  add constraint wardrobe_items_cover_fk
  foreign key (cover_image_id) references public.item_images(id) on delete set null;

-- ---------------------------------------------------------------------------
-- item_style_tags
--
-- A junction with a weight, not a text[]. A garment is 0.9 y2k AND 0.4 soft at
-- the same time, and vibe matching is a weighted dot product, not a set
-- membership test -- a faint reference and a statement piece must not score
-- identically. Nothing reads this until M2; it exists now so M2 needs no
-- migration.
-- ---------------------------------------------------------------------------

create table public.item_style_tags (
  item_id  uuid not null references public.wardrobe_items(id) on delete cascade,
  tag_code text not null references public.style_tag(code),
  user_id  uuid not null references auth.users(id) on delete cascade,
  weight   numeric(3,2) not null default 1.0 check (weight >= 0 and weight <= 1),
  -- 'user' or 'ai'. Lets a later re-tag pass overwrite its own guesses only.
  source   text not null default 'user',
  primary key (item_id, tag_code)
);

create index item_style_tags_lookup on public.item_style_tags (user_id, tag_code);

-- ---------------------------------------------------------------------------
-- outfits
-- ---------------------------------------------------------------------------

create table public.outfits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text,
  -- 'manual' in M1; 'suggested' once the engine writes them in M2.
  source     text not null default 'manual',
  created_at timestamptz not null default now()
);

create table public.outfit_items (
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  item_id   uuid not null references public.wardrobe_items(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  z_index   smallint not null default 0,
  primary key (outfit_id, item_id)
);

create index outfits_user      on public.outfits (user_id, created_at desc);
create index outfit_items_item on public.outfit_items (item_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger wardrobe_items_touch
  before update on public.wardrobe_items
  for each row execute function public.touch_updated_at();

-- FOOTGUN 1 of 3: user_id is denormalised onto every child table so its RLS
-- policy can be a direct indexed comparison. An EXISTS(...) policy re-runs per
-- row; `(select auth.uid()) = user_id` is an initplan evaluated once. On a
-- 200-item grid that is the difference between 8ms and 200ms.
--
-- The trigger copies user_id from the parent and OVERWRITES whatever the
-- client sent, so the denormalised copy cannot drift or be forged.
create or replace function public.inherit_user_id_from_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select i.user_id into new.user_id
  from public.wardrobe_items i where i.id = new.item_id;
  return new;
end $$;

create trigger item_images_inherit_user
  before insert or update on public.item_images
  for each row execute function public.inherit_user_id_from_item();

create trigger item_style_tags_inherit_user
  before insert or update on public.item_style_tags
  for each row execute function public.inherit_user_id_from_item();

create or replace function public.inherit_user_id_from_outfit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select o.user_id into new.user_id
  from public.outfits o where o.id = new.outfit_id;
  return new;
end $$;

create trigger outfit_items_inherit_user
  before insert or update on public.outfit_items
  for each row execute function public.inherit_user_id_from_outfit();

-- ---------------------------------------------------------------------------
-- RLS. This is the "dedicated only to you" promise. Retrofitting it onto
-- populated tables is miserable, so it ships with the first migration.
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.wardrobe_items  enable row level security;
alter table public.item_images     enable row level security;
alter table public.item_style_tags enable row level security;
alter table public.outfits         enable row level security;
alter table public.outfit_items    enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own items" on public.wardrobe_items
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own images" on public.item_images
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own item tags" on public.item_style_tags
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own outfits" on public.outfits
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own outfit items" on public.outfit_items
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('wardrobe', 'wardrobe', false)
on conflict (id) do nothing;

-- FOOTGUN 2 of 3: these policies key on the PATH PREFIX, not on `owner`.
-- `owner` is NULL when an Edge Function writes with the service role, so any
-- policy keyed on ownership silently locks users out of their own tiles the
-- moment the cutout pipeline writes one. Putting {user_id} first in the path
-- makes the check a single indexed string comparison.
create policy "own folder read" on storage.objects
  for select to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own folder insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own folder update" on storage.objects
  for update to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own folder delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- FOOTGUN 3 of 3, guarded rather than documented.
--
-- A view runs with its OWNER's privileges and RLS on the underlying tables is
-- NOT applied. A single `create view wardrobe_item_view as select * from
-- wardrobe_items` without security_invoker would hand every user's entire
-- closet to every other user.
--
-- There are no views in this schema today (the closet grid uses PostgREST
-- resource embedding instead, which respects RLS). This assertion exists so
-- that the day someone adds one, the migration fails loudly instead of
-- shipping a data breach.
-- ---------------------------------------------------------------------------

do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=%';
  if bad is not null then
    raise exception 'view(s) without security_invoker=true: %', bad;
  end if;
end $$;
