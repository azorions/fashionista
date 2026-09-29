-- Taxonomy: the closed axes as enums, plus the subcategory knowledge table.
--
-- These enums mirror the const arrays in src/domain/tagging/schema.ts, and
-- schema.test.ts parses this file to prove they still agree. If you add a value
-- here, add it there in the same commit.
--
-- Subcategory is a TABLE, not an enum, for two reasons: it grows constantly
-- (shrug, bolero, gilet), and it is the natural home for garment knowledge --
-- the defaults that let the capture form ask three questions instead of
-- fifteen. Adding one is an INSERT, not an ALTER TYPE ADD VALUE, which cannot
-- be used in the transaction that creates it (and Supabase wraps each
-- migration in one).

-- pgvector installs now even though nothing uses it. Installing an extension
-- later is the kind of friction that gets deferred forever; the embedding
-- COLUMN waits until M3, when the model -- and therefore its dimension -- is
-- actually chosen.
create extension if not exists vector with schema extensions;

create type body_zone as enum (
  'torso', 'legs', 'full_body', 'feet', 'head', 'neck', 'hands', 'waist', 'carried'
);

-- Not derivable from subcategory: a flannel is a base layer worn alone and a
-- mid layer worn over a tee. Collapsing this axis is what makes "winter =
-- layered" suggest parka-over-parka.
create type layer_role as enum (
  'base', 'mid', 'outer', 'bottom', 'overbottom', 'full_body', 'footwear', 'accessory'
);

create type garment_category as enum (
  'top', 'bottom', 'dress', 'outerwear', 'footwear', 'accessory'
);

create type pattern as enum (
  'solid', 'stripe', 'check', 'floral', 'graphic', 'animal', 'geometric', 'other'
);

-- Two large patterns clash; large plus micro does not.
create type pattern_scale as enum ('none', 'micro', 'small', 'medium', 'large');

create type silhouette as enum ('fitted', 'straight', 'relaxed', 'oversized', 'flared');

create type garment_length as enum (
  'n_a', 'crop', 'hip', 'thigh', 'knee', 'midi', 'ankle', 'full'
);

-- The strongest y2k signal there is.
create type rise as enum ('n_a', 'low', 'mid', 'high');

create type sheen as enum ('matte', 'subtle', 'shiny');

create type material as enum (
  'cotton', 'linen', 'wool', 'cashmere', 'denim', 'leather', 'silk',
  'synthetic', 'knit', 'fleece', 'down', 'other'
);

-- ---------------------------------------------------------------------------
-- Subcategory knowledge. Every default here is a question the capture form
-- does not have to ask.
-- ---------------------------------------------------------------------------

create table public.garment_subcategory (
  code                text primary key,
  label               text not null,
  category            garment_category not null,
  default_body_zone   body_zone   not null,
  default_layer_role  layer_role  not null,
  alt_layer_roles     layer_role[] not null default '{}',
  default_warmth        smallint not null check (default_warmth between 1 and 5),
  default_breathability smallint not null check (default_breathability between 1 and 5),
  default_bulk          smallint not null check (default_bulk between 1 and 5),
  default_formality     smallint not null check (default_formality between 1 and 5),
  default_silhouette  silhouette    not null default 'straight',
  default_length      garment_length not null default 'n_a',
  default_rise        rise          not null default 'n_a',
  sort                smallint not null default 100,
  -- What a garment of this type is usually made of and looks like. Without
  -- these, every real garment had no materials, a solid pattern and a matte
  -- finish, and every material, pattern and shine rule in the vibes was dead.
  -- They are only starting points: the capture form's "More details" lets the
  -- user correct them item by item, which matters most for pattern and shine.
  default_materials     material[]    not null default '{}',
  default_pattern       pattern       not null default 'solid',
  default_pattern_scale pattern_scale not null default 'none',
  default_sheen         sheen         not null default 'matte'
);

comment on table public.garment_subcategory is
  'Reference data. Readable by every authenticated user, writable by nobody through the API.';

insert into public.garment_subcategory
  (code, label, category, default_body_zone, default_layer_role, alt_layer_roles,
   default_warmth, default_breathability, default_bulk, default_formality,
   default_silhouette, default_length, default_rise, sort,
   default_materials, default_pattern, default_pattern_scale, default_sheen)
values
  -- tops
  ('tank',        'Tank top',      'top',  'torso', 'base', '{}',        1, 5, 1, 1, 'fitted',   'hip',  'n_a', 10, '{cotton}', 'solid', 'none', 'matte'),
  ('tee',         'T-shirt',       'top',  'torso', 'base', '{}',        2, 4, 2, 2, 'straight', 'hip',  'n_a', 11, '{cotton}', 'solid', 'none', 'matte'),
  ('crop_top',    'Crop top',      'top',  'torso', 'base', '{}',        1, 4, 1, 2, 'fitted',   'crop', 'n_a', 12, '{cotton}', 'solid', 'none', 'matte'),
  ('long_sleeve', 'Long sleeve',   'top',  'torso', 'base', '{mid}',     3, 3, 2, 2, 'straight', 'hip',  'n_a', 13, '{cotton}', 'solid', 'none', 'matte'),
  ('shirt',       'Shirt',         'top',  'torso', 'base', '{mid}',     2, 4, 2, 3, 'straight', 'hip',  'n_a', 14, '{cotton}', 'solid', 'none', 'matte'),
  ('flannel',     'Flannel shirt', 'top',  'torso', 'base', '{mid,outer}', 3, 3, 3, 2, 'relaxed', 'hip', 'n_a', 15, '{cotton}', 'check', 'medium', 'matte'),
  ('blouse',      'Blouse',        'top',  'torso', 'base', '{}',        2, 4, 1, 4, 'relaxed',  'hip',  'n_a', 16, '{synthetic}', 'solid', 'none', 'subtle'),
  ('polo',        'Polo',          'top',  'torso', 'base', '{}',        2, 4, 2, 3, 'straight', 'hip',  'n_a', 17, '{cotton}', 'solid', 'none', 'matte'),
  ('sweater',     'Sweater',       'top',  'torso', 'mid',  '{base}',    4, 2, 4, 3, 'relaxed',  'hip',  'n_a', 20, '{knit,wool}', 'solid', 'none', 'matte'),
  ('cardigan',    'Cardigan',      'top',  'torso', 'mid',  '{outer}',   3, 3, 3, 3, 'relaxed',  'hip',  'n_a', 21, '{knit}', 'solid', 'none', 'matte'),
  ('hoodie',      'Hoodie',        'top',  'torso', 'mid',  '{outer}',   4, 2, 4, 1, 'oversized','hip',  'n_a', 22, '{cotton,fleece}', 'solid', 'none', 'matte'),
  ('sweatshirt',  'Sweatshirt',    'top',  'torso', 'mid',  '{base}',    3, 2, 3, 1, 'relaxed',  'hip',  'n_a', 23, '{cotton,fleece}', 'solid', 'none', 'matte'),
  ('vest',        'Vest',          'top',  'torso', 'mid',  '{}',        2, 3, 2, 3, 'fitted',   'hip',  'n_a', 24, '{knit}', 'solid', 'none', 'matte'),
  -- bottoms
  ('jeans',       'Jeans',         'bottom', 'legs', 'bottom', '{}',     3, 2, 3, 2, 'straight', 'full',  'mid',  30, '{denim}', 'solid', 'none', 'matte'),
  ('low_jeans',   'Low-rise jeans','bottom', 'legs', 'bottom', '{}',     3, 2, 3, 2, 'flared',   'full',  'low',  31, '{denim}', 'solid', 'none', 'matte'),
  ('trousers',    'Trousers',      'bottom', 'legs', 'bottom', '{}',     2, 3, 2, 4, 'straight', 'full',  'mid',  32, '{wool}', 'solid', 'none', 'matte'),
  ('chinos',      'Chinos',        'bottom', 'legs', 'bottom', '{}',     2, 3, 2, 3, 'straight', 'full',  'mid',  33, '{cotton}', 'solid', 'none', 'matte'),
  ('shorts',      'Shorts',        'bottom', 'legs', 'bottom', '{}',     1, 5, 2, 1, 'straight', 'thigh', 'mid',  34, '{cotton}', 'solid', 'none', 'matte'),
  ('skirt',       'Skirt',         'bottom', 'legs', 'bottom', '{}',     2, 4, 2, 3, 'straight', 'knee',  'mid',  35, '{cotton}', 'solid', 'none', 'matte'),
  ('mini_skirt',  'Mini skirt',    'bottom', 'legs', 'bottom', '{}',     1, 4, 1, 2, 'fitted',   'thigh', 'low',  36, '{cotton}', 'solid', 'none', 'matte'),
  ('joggers',     'Joggers',       'bottom', 'legs', 'bottom', '{}',     3, 2, 3, 1, 'relaxed',  'full',  'mid',  37, '{cotton,fleece}', 'solid', 'none', 'matte'),
  ('leggings',    'Leggings',      'bottom', 'legs', 'bottom', '{}',     2, 3, 1, 1, 'fitted',   'full',  'high', 38, '{synthetic}', 'solid', 'none', 'matte'),
  -- one-piece
  ('dress',       'Dress',         'dress', 'full_body', 'full_body', '{}', 2, 4, 2, 4, 'straight', 'knee', 'n_a', 40, '{cotton}', 'solid', 'none', 'matte'),
  ('maxi_dress',  'Maxi dress',    'dress', 'full_body', 'full_body', '{}', 2, 4, 2, 4, 'flared',   'ankle','n_a', 41, '{cotton}', 'solid', 'none', 'matte'),
  ('jumpsuit',    'Jumpsuit',      'dress', 'full_body', 'full_body', '{}', 2, 3, 2, 3, 'straight', 'full', 'n_a', 42, '{cotton}', 'solid', 'none', 'matte'),
  -- outerwear
  ('denim_jacket','Denim jacket',  'outerwear', 'torso', 'outer', '{mid}', 3, 2, 3, 2, 'straight', 'hip', 'n_a', 50, '{denim}', 'solid', 'none', 'matte'),
  ('bomber',      'Bomber jacket', 'outerwear', 'torso', 'outer', '{}',    3, 2, 3, 2, 'relaxed',  'hip', 'n_a', 51, '{synthetic}', 'solid', 'none', 'subtle'),
  ('leather_jacket','Leather jacket','outerwear','torso','outer', '{}',    3, 1, 3, 3, 'fitted',   'hip', 'n_a', 52, '{leather}', 'solid', 'none', 'subtle'),
  ('blazer',      'Blazer',        'outerwear', 'torso', 'outer', '{mid}', 3, 3, 2, 5, 'fitted',   'hip', 'n_a', 53, '{wool}', 'solid', 'none', 'matte'),
  ('raincoat',    'Raincoat',      'outerwear', 'torso', 'outer', '{}',    3, 1, 3, 2, 'straight', 'thigh','n_a', 54, '{synthetic}', 'solid', 'none', 'subtle'),
  ('wool_coat',   'Wool coat',     'outerwear', 'torso', 'outer', '{}',    5, 1, 4, 4, 'straight', 'knee', 'n_a', 55, '{wool}', 'solid', 'none', 'matte'),
  ('puffer',      'Puffer jacket', 'outerwear', 'torso', 'outer', '{}',    5, 1, 5, 1, 'oversized','hip',  'n_a', 56, '{down,synthetic}', 'solid', 'none', 'subtle'),
  ('parka',       'Parka',         'outerwear', 'torso', 'outer', '{}',    5, 1, 5, 1, 'oversized','thigh','n_a', 57, '{synthetic,down}', 'solid', 'none', 'matte'),
  -- footwear
  ('sneakers',    'Sneakers',      'footwear', 'feet', 'footwear', '{}', 2, 3, 2, 2, 'straight', 'n_a', 'n_a', 60, '{synthetic}', 'solid', 'none', 'matte'),
  ('boots',       'Boots',         'footwear', 'feet', 'footwear', '{}', 4, 1, 3, 3, 'straight', 'n_a', 'n_a', 61, '{leather}', 'solid', 'none', 'matte'),
  ('sandals',     'Sandals',       'footwear', 'feet', 'footwear', '{}', 1, 5, 1, 2, 'straight', 'n_a', 'n_a', 62, '{leather}', 'solid', 'none', 'matte'),
  ('loafers',     'Loafers',       'footwear', 'feet', 'footwear', '{}', 2, 3, 2, 4, 'straight', 'n_a', 'n_a', 63, '{leather}', 'solid', 'none', 'subtle'),
  ('heels',       'Heels',         'footwear', 'feet', 'footwear', '{}', 1, 3, 1, 5, 'fitted',   'n_a', 'n_a', 64, '{leather}', 'solid', 'none', 'subtle'),
  -- accessories
  ('bag',         'Bag',           'accessory', 'carried', 'accessory', '{}', 1, 3, 2, 3, 'straight','n_a','n_a', 70, '{leather}', 'solid', 'none', 'matte'),
  ('hat',         'Hat',           'accessory', 'head',    'accessory', '{}', 2, 3, 2, 2, 'straight','n_a','n_a', 71, '{cotton}', 'solid', 'none', 'matte'),
  ('scarf',       'Scarf',         'accessory', 'neck',    'accessory', '{}', 4, 2, 3, 2, 'straight','n_a','n_a', 72, '{wool,knit}', 'solid', 'none', 'matte'),
  ('belt',        'Belt',          'accessory', 'waist',   'accessory', '{}', 1, 3, 1, 3, 'straight','n_a','n_a', 73, '{leather}', 'solid', 'none', 'matte'),
  ('jewelry',     'Jewellery',     'accessory', 'neck',    'accessory', '{}', 1, 3, 1, 3, 'fitted',  'n_a','n_a', 74, '{other}', 'solid', 'none', 'shiny'),
  ('sunglasses',  'Sunglasses',    'accessory', 'head',    'accessory', '{}', 1, 3, 1, 2, 'straight','n_a','n_a', 75, '{synthetic}', 'solid', 'none', 'subtle'),
  -- the fallback the tagger falls back to, so capture never hard-fails
  ('unknown',     'Unsorted',      'top', 'torso', 'base', '{}', 2, 3, 2, 2, 'straight', 'n_a', 'n_a', 999, '{}', 'solid', 'none', 'matte');

-- ---------------------------------------------------------------------------
-- Style tags: open vocabulary, weighted per garment. See item_style_tags.
-- ---------------------------------------------------------------------------

create table public.style_tag (
  code  text primary key,
  label text not null,
  sort  smallint not null default 100
);

insert into public.style_tag (code, label, sort) values
  ('y2k',          'Y2K',          10),
  ('soft',         'Soft',         20),
  ('minimal',      'Minimal',      30),
  ('streetwear',   'Streetwear',   40),
  ('smart_casual', 'Smart casual', 50),
  ('sporty',       'Sporty',       60),
  ('romantic',     'Romantic',     70),
  ('edgy',         'Edgy',         80),
  ('preppy',       'Preppy',       90),
  ('vintage',      'Vintage',     100),
  ('cozy',         'Cozy',        110);

-- Reference data: readable by anyone signed in, writable only via migrations.
alter table public.garment_subcategory enable row level security;
alter table public.style_tag           enable row level security;

create policy "subcategory readable" on public.garment_subcategory
  for select to authenticated using (true);
create policy "style tags readable" on public.style_tag
  for select to authenticated using (true);
