# Not in milestone 1

Milestone 1 is a **thin vertical slice**: sign in, photograph one garment, cut
it out, save it, tag it, see it in the grid, stack two items into an outfit.
Narrow but complete — every layer real, nothing stubbed.

Each item below looks individually cheap. Collectively they are what turns a
two-week slice into a three-month build with nothing to show. If you want to
add a row to the task list, delete one first.

## Deferred, with the reason

| Thing | Why not now |
|---|---|
| Gallery import / bulk add | A completely different quality distribution — no capture guardrails, arbitrary aspect ratios, screenshots of shop listings. Needs its own gate design. **M3** |
| Manual tag editing | You are the only user and you just typed the tags. **M3** |
| AI auto-tagging | Costs ~$0.025/item. Worth paying only once bulk import makes manual tagging painful. The schema and Edge Function are designed now; only the model call is deferred. **M3** |
| The vibe engine | Not a risky seam — it is self-contained logic over data that does not exist yet. **M2** |
| On-device cutout (Vision / ML Kit) | Every wrapper is a native module, so it ends the Expo Go loop, and they are all 0.x single-author packages. It is a *cost* optimisation for a cost we are not paying. **Phase 2** |
| react-native-vision-camera | Same reason. Live metrics are "expo-gl or nothing" until a dev client exists. |
| The stylize rescue hatch | A rescue for a failure mode not yet observed. Building it early creates pressure to make it the default, which is exactly what the cutout-first decision rules out. **M5** |
| Manual crop / rotate / edge touch-up | The premise is that capture guardrails make correction unnecessary. Build it only if calibration data shows people keeping bad tiles. |
| Multi-garment detection in one photo | Cheap to add, but turns one capture into an N-item disambiguation UI. **M3** |
| Provider failover, retry ladders, queueing | The adapter seam exists; the logic does not. One provider, one attempt, an honest error state. |
| Offline capture queue | Real feature, real complexity. M1 assumes connectivity and says so in the error state. |
| Supabase Realtime | Polling a row every 800ms for the ~5s a cutout takes beats a websocket plus RLS-on-replication config. **M4+** |
| EAS builds of any kind | Run `eas init` to reserve the project id, then stop. A dev client is work for the day Expo Go stops being enough. |
| CI (GitHub Actions) | `npm run check` before committing gets 95% of the value solo. **M3** |
| Component / E2E tests | Near-zero value against the phone in your hand, high maintenance. The pure logic in `src/domain` is what gets tested. |
| Encrypted session storage | AsyncStorage now; LargeSecureStore is a **M5** hardening item. |
| pgvector column + HNSW index | The extension installs in M1; the column waits until the embedding model is chosen, because its dimension is part of the type. No index until ~5,000 items. |
| Storybook, design-system build-out | `components/ui/` gets exactly the primitives the slice needs and grows on demand. |
| Monorepo, shared packages | One package.json. The one genuinely-shared file gets a relative import and a guard test. |
| expo-updates, Sentry, analytics, deep links, push, icons, i18n, dark mode | **M5** |

## The completion test

Behavioural, not featural: **hand someone the phone; they sign in as themselves,
photograph a real shirt, and see that shirt in their own closet.** If any step
needs you to say "that part isn't hooked up yet", it is not a slice.
