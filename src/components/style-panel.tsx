import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { OutfitCard } from '@/components/ui/outfit-card';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { Garment, ScoredOutfit } from '@/domain/styling/types';
import { VIBE_LIST } from '@/domain/styling/vibes';
import { useSuggestions } from '@/features/useSuggestions';

/** Thumbnail fields are optional: the dev preview's fixtures have none. */
type PanelGarment = Garment & { thumbUrl?: string | null; thumbPath?: string | null };

interface Props {
  wardrobe: PanelGarment[];
  /** Falls back to summer when missing or not a vibe id. */
  initialVibe?: string;
  lockedId?: string | null;
  onClearLock?: () => void;
  /** No Save buttons without it. */
  onSave?: (outfit: ScoredOutfit, vibeId: string) => Promise<void>;
}

/**
 * A vibe that can actually wear the locked piece. Summer allows one layer, so
 * a locked jacket or sweater there could never appear and "style around this"
 * always opened on "nothing goes with this piece".
 */
function vibeForLock(vibe: string, lockedId: string | null | undefined, wardrobe: Garment[]) {
  const g = lockedId ? wardrobe.find((w) => w.id === lockedId) : undefined;
  const layered = g?.layerRole === 'mid' || g?.layerRole === 'outer';
  const spec = VIBE_LIST.find((v) => v.id === vibe);
  if (!layered || (spec && spec.layers.max > 1)) return vibe;
  return VIBE_LIST.find((v) => v.layers.max > 1)?.id ?? vibe;
}

/**
 * Pick a vibe, get outfits.
 *
 * Takes the wardrobe as a prop rather than reading the closet, so the dev
 * preview can drive it from fixtures with no account and no database.
 */
export function StylePanel({ wardrobe, initialVibe, lockedId, onClearLock, onSave }: Props) {
  // A lookup on VIBES would accept ?vibe=toString and crash the engine.
  const [vibe, setVibe] = useState(() =>
    vibeForLock(VIBE_LIST.find((v) => v.id === initialVibe)?.id ?? 'summer', lockedId, wardrobe),
  );
  // A lock can also arrive later: the garment page returns to this same,
  // already-mounted tab with a new ?lock=.
  const [lockSeen, setLockSeen] = useState(lockedId);
  if (lockedId !== lockSeen) {
    setLockSeen(lockedId);
    setVibe(vibeForLock(vibe, lockedId, wardrobe));
  }
  const { result, resultVibe, pending, locked } = useSuggestions(wardrobe, vibe, lockedId);

  // suggest() is typed to return Garment; look the thumbnails back up by id
  // rather than trusting it to hand back the very objects it was given.
  const byId = useMemo(() => new Map(wardrobe.map((g) => [g.id, g])), [wardrobe]);

  // Opened on a vibe near the end of the row (?vibe=cozy), the selected chip
  // started off-screen and nothing visible said which vibe this was. Scroll
  // it into view once; chips the user taps are already on screen.
  const bar = useRef<ScrollView>(null);
  const [firstVibe] = useState(vibe);
  const { width } = useWindowDimensions();

  if (wardrobe.length === 0) return <Note>Add a few garments to your closet first.</Note>;
  if (!wardrobe.some((g) => g.bodyZone === 'feet' && g.subcategory !== 'unknown')) {
    return <Note>Every outfit needs shoes — add a pair to get suggestions.</Note>;
  }

  const label = VIBE_LIST.find((v) => v.id === resultVibe)?.label.toLowerCase();

  return (
    <View style={styles.fill}>
      <ScrollView
        ref={bar}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.vibeBar}
        contentContainerStyle={styles.vibes}
      >
        {VIBE_LIST.map((v) => (
          <View
            key={v.id}
            onLayout={
              v.id === firstVibe
                ? (e) => {
                    const { x, width: w } = e.nativeEvent.layout;
                    // Only when it is actually cut off; scrolling Winter
                    // into place pushed Summer half off the left edge.
                    if (x + w + Spacing.three > width) {
                      bar.current?.scrollTo({ x: x - Spacing.three, animated: false });
                    }
                  }
                : undefined
            }
          >
            <Chip label={v.label} selected={v.id === vibe} onPress={() => setVibe(v.id)} />
          </View>
        ))}
      </ScrollView>

      {locked ? (
        <ThemedView type="backgroundElement" style={styles.banner}>
          <ThemedText type="small" numberOfLines={1} style={styles.bannerText}>
            Styling around: {locked.name ?? locked.subcategory.replace(/_/g, ' ')}
          </ThemedText>
          {onClearLock ? (
            <Button
              variant="text"
              label="Clear"
              onPress={onClearLock}
              accessibilityHint="Suggests outfits from your whole closet"
              style={styles.clear}
            />
          ) : null}
        </ThemedView>
      ) : null}

      <ScrollView
        style={pending && styles.pending}
        contentContainerStyle={styles.list}
        accessibilityState={{ busy: pending }}
      >
        {result.outfits.length === 0 ? (
          <ThemedText>
            {locked
              ? `Nothing goes with this piece for ${label} yet.`
              : `Nothing in your closet makes a ${label} outfit yet.`}
          </ThemedText>
        ) : null}

        {result.outfits.map((o) => {
          const ids = o.items.map((g) => g.id);
          return (
            <SuggestionCard
              // Keyed by vibe too, so a card's saved state resets with the vibe.
              key={`${resultVibe}:${ids.join('|')}`}
              items={o.items.map((g) => byId.get(g.id) ?? g)}
              why={o.why}
              // resultVibe, not vibe: while pending the cards on screen still
              // belong to the previous vibe, and must be saved under it.
              onSave={onSave ? () => onSave(o, resultVibe) : undefined}
            />
          );
        })}

        {result.gaps.map((g) => (
          <ThemedText key={g.role} type="small" themeColor="textSecondary">
            {g.message}
          </ThemedText>
        ))}
      </ScrollView>
    </View>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function SuggestionCard({
  items,
  why,
  onSave,
}: {
  items: PanelGarment[];
  why: string;
  onSave?: () => Promise<void>;
}) {
  const [state, setState] = useState<SaveState>('idle');
  // Two taps can land before the disabled button re-renders, and each would
  // save a separate copy of the outfit. The ref is set synchronously.
  const inFlight = useRef(false);

  async function save() {
    if (!onSave || inFlight.current) return;
    inFlight.current = true;
    setState('saving');
    try {
      await onSave();
      setState('saved');
    } catch {
      inFlight.current = false;
      setState('error');
    }
  }

  return (
    <OutfitCard items={items} why={why}>
      {onSave ? (
        <>
          {state === 'error' ? (
            <ThemedText type="small" themeColor="danger">
              Could not save.
            </ThemedText>
          ) : null}
          <Button
            variant="secondary"
            label={state === 'saved' ? 'Saved' : state === 'error' ? 'Try again' : 'Save'}
            busy={state === 'saving'}
            disabled={state === 'saved'}
            onPress={save}
            accessibilityHint="Keeps this outfit in your Outfits tab"
          />
        </>
      ) : null}
    </OutfitCard>
  );
}

function Note({ children }: { children: string }) {
  return (
    <View style={styles.centre}>
      <ThemedText themeColor="textSecondary" style={styles.centred}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // A horizontal ScrollView grows by default and would split the height with
  // the list below it -- and on web it also SHRINKS, which crushed the chips
  // to a sliver with invisible labels.
  vibeBar: { flexGrow: 0, flexShrink: 0 },
  vibes: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two },
  banner: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    borderRadius: Radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  bannerText: { flex: 1 },
  clear: { minHeight: 44, paddingHorizontal: Spacing.two, justifyContent: 'center' },
  pending: { opacity: 0.5 },
  list: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  centred: { textAlign: 'center' },
});
