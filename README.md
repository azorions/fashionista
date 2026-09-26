# Fashionista

Photograph the clothes you own; each photo becomes a clean, uniform tile in a
closet that belongs only to you. Mix and match on screen to see an outfit
without putting it on — or ask the app to suggest one for a vibe.

Expo (SDK 57) + Supabase. iOS and Android.

## Getting started

```bash
npm install
npm run check      # typecheck + lint + tests. Works with no Supabase project.
```

That much runs today. To get the app itself working you need a Supabase
project, in this order — steps 3 and 5 fail *silently* if you skip them.

1. **Create a project** at supabase.com (one is enough; add a separate prod
   project when you have data you would be upset to lose).
2. **Push the schema.**
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-ref>
   npm run db:diff    # dry run, always first
   npm run db:push
   npm run db:types   # writes src/types/database.ts
   ```
3. **Switch the email template.** Auth → Email Templates → *Magic Link*, and
   replace `{{ .ConfirmationURL }}` with `{{ .Token }}`. Without this you get
   emailed a link when the app is asking for a six-digit code, and sign-in
   just never completes with no error shown.
4. **Fill in `.env.local`** from `.env.example` — project URL and the
   publishable (`sb_publishable_…`) key. Restart the dev server after.
5. **Set the Edge Function secrets and deploy it.**
   ```bash
   npx supabase secrets set REPLICATE_API_TOKEN=...
   npx supabase functions deploy process-garment
   ```
   Without the token, capture uploads fine and then the cutout fails, leaving
   every tile stuck on a spinner.
6. `npm start`, scan the QR in Expo Go.

Run `npm run check` before every commit.

## Two things to do first

Two assumptions cannot be verified from a desktop. Open the app and tap
**Open dev spikes** on the closet tab.

1. **Live camera pixels** (blocking). `expo-camera` has no frame-processor API,
   so live quality warnings depend on `GLView.createCameraTextureAsync()` — an
   API originally documented against the legacy `Camera` component, before
   expo-camera was rewritten to `CameraView`. Timebox this to half a day. If it
   fails, cut live warnings: keep the static framing guide and let the
   post-shutter gate catch bad photos. Do **not** fall back to polling
   `takePictureAsync()`.
2. **fast-png under Hermes** (has a cheap fallback). Metro already resolves it —
   the production bundle builds — but the spike confirms it *runs*. If it does
   not, palette extraction moves into the Edge Function unchanged.

## Layout

```
src/
  app/          expo-router tree. Stack at the root, tabs in (tabs).
  domain/       ★ pure TypeScript — no react-native, no expo-*, no I/O
  lib/          impure adapters. All platform and network code lives here.
  components/   shared UI
  stores/       zustand: in-flight capture, outfit canvas
supabase/
  migrations/   forward-only SQL, applied with `npx supabase db push`
  functions/    Edge Functions (cutout, post-processing)
docs/decisions/ NOT-IN-M1.md and the ADRs
```

### The `src/domain` boundary

An ESLint rule forbids `react-native`, `expo-*` and the Supabase client inside
`src/domain`. That is what lets the quality scorer, the colour maths and (in
milestone 2) the whole styling engine run under `npm test` in about two seconds
in plain Node — no Metro, no simulator, no phone.

If you need a native API, put the adapter in `src/lib/` and have it hand plain
data across the boundary.

## Secrets

Expo inlines every `EXPO_PUBLIC_*` variable into the bundle **in plain text**.
Only the Supabase URL and publishable key may be public — the publishable key
is designed to be, and Row Level Security is what actually protects the data.

Everything else — the Supabase secret key, the cutout provider token, any model
API key — belongs in `npx supabase secrets set` and is read only by Edge
Functions.

## Database

There is no local Supabase stack (it needs Docker, which is not installed).
Work against two free cloud projects, `fashionista-dev` and `fashionista-prod`;
link to dev and treat it as disposable — deleting and recreating a free project
takes about two minutes and is the Docker-free equivalent of `db reset`.

```bash
npx supabase link --project-ref <ref>
npm run db:new  <name>     # create a migration file — never click in the dashboard
npm run db:diff            # dry run, always do this first
npm run db:push
npm run db:types           # regenerate src/types/database.ts; never hand-edit it
```

## Scope

Milestone 1 is a thin vertical slice and is deliberately missing a lot.
See [docs/decisions/NOT-IN-M1.md](docs/decisions/NOT-IN-M1.md) before adding
anything to it.
