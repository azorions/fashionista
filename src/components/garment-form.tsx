import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ChipRow } from '@/components/ui/chip';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { oklchToRgb, rgbToHex } from '@/domain/color/oklab';
import type { Swatch } from '@/domain/color/palette';
import { rowToDefaults, type SubcategoryRow } from '@/domain/garment/row';
import {
  CATEGORIES,
  MATERIALS,
  PATTERNS,
  SHEENS,
  STYLE_TAGS,
  type Category,
  type GarmentForm as FormValues,
  type Material,
  type Pattern,
  type PatternScale,
  type Sheen,
  type StyleTag,
} from '@/domain/tagging/schema';
import { useTheme } from '@/hooks/use-theme';

/** smart_casual -> "Smart casual". y2k is the one code that is not a word. */
export const humanize = (code: string) =>
  code === 'y2k' ? 'Y2K' : code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, ' ');

const options = <T extends string>(values: readonly T[]) =>
  values.map((value) => ({ value, label: humanize(value) }));

const CATEGORY_OPTIONS = options(CATEGORIES);
const PATTERN_OPTIONS = options(PATTERNS);
// No 'micro': the scorer treats it exactly like small, so it is not worth a chip.
const SCALE_OPTIONS = options<PatternScale>(['small', 'medium', 'large']);
const MATERIAL_OPTIONS = options(MATERIALS);
const SHEEN_OPTIONS = options(SHEENS);
const TAG_OPTIONS = options(STYLE_TAGS);

/** What "More details" edits. Always complete, so the save never guesses. */
interface Details {
  pattern: Pattern;
  patternScale: PatternScale;
  materials: Material[];
  sheen: Sheen;
  styleTags: StyleTag[];
}

/** Solid has no scale, and a pattern never keeps a hidden 'none'. */
const scaleFor = (pattern: Pattern, scale: PatternScale): PatternScale =>
  pattern === 'solid' ? 'none' : scale === 'none' ? 'medium' : scale;

function fromDefaults(sub: SubcategoryRow): Details {
  const d = rowToDefaults(sub);
  return {
    pattern: d.pattern,
    patternScale: scaleFor(d.pattern, d.patternScale),
    materials: d.materials,
    sheen: d.sheen,
    styleTags: [],
  };
}

function fromForm(f: FormValues): Details {
  const pattern = f.pattern ?? 'solid';
  return {
    pattern,
    patternScale: scaleFor(pattern, f.patternScale ?? 'none'),
    materials: f.materials ?? [],
    sheen: f.sheen ?? 'matte',
    styleTags: (f.styleTags ?? []).map((t) => t.tag),
  };
}

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/** "Cotton · solid · matte": what the folded section would say if opened. */
function summary(d: Details) {
  const line = [
    d.materials.join(', '),
    d.pattern === 'solid' ? 'solid' : `${d.patternScale} ${d.pattern}`,
    d.sheen,
    d.styleTags.map(humanize).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

interface Props {
  subcategories: SubcategoryRow[] | undefined;
  /** The kinds failed to load; the caller shows the retry. Stops the spinner. */
  subcategoriesFailed?: boolean;
  /** Edit mode: the garment as saved. Read once, at mount. */
  initial?: FormValues;
  submitLabel: string;
  /** Throw to show the message; resolve after navigating away. */
  onSubmit: (form: FormValues, sub: SubcategoryRow) => Promise<void>;
  header?: ReactNode;
}

/**
 * The garment form, shared by capture and edit.
 *
 * Kind first, because the kind supplies everything else: the details are
 * prefilled from its defaults and reset -- visibly -- when the kind changes,
 * since a jumper's knit and wool are wrong for the jeans it was mis-tapped as.
 * They stay folded away: most garments never need them, and the twentieth
 * capture of a session should cost three taps.
 */
export function GarmentForm({
  subcategories,
  subcategoriesFailed,
  initial,
  submitLabel,
  onSubmit,
  header,
}: Props) {
  const theme = useTheme();

  const [category, setCategory] = useState<Category>(initial?.category ?? 'top');
  // 'unknown' is the placeholder a capture starts as, never a real answer.
  const [subcategory, setSubcategory] = useState<string | null>(
    initial && initial.subcategory !== 'unknown' ? initial.subcategory : null,
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [details, setDetails] = useState<Details | null>(initial ? fromForm(initial) : null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State alone lets a fast double tap through before the re-render disables the button.
  const inFlight = useRef(false);

  const forCategory = (subcategories ?? []).filter(
    (s) => s.category === category && s.code !== 'unknown',
  );
  const sub = forCategory.find((s) => s.code === subcategory);

  function pickCategory(c: Category) {
    if (c === category) return;
    setCategory(c);
    setSubcategory(null);
  }

  function pickSub(code: string) {
    const next = forCategory.find((s) => s.code === code);
    if (!next || code === subcategory) return;
    setSubcategory(code);
    // Re-picking the saved kind brings back what was saved, not its defaults.
    setDetails(initial && code === initial.subcategory ? fromForm(initial) : fromDefaults(next));
  }

  const patch = (p: Partial<Details>) => setDetails((d) => (d ? { ...d, ...p } : d));

  async function submit() {
    if (!sub || !details || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(
        {
          category,
          subcategory: sub.code,
          name: name.trim() || undefined,
          // Every detail, explicitly: the save writes what is on screen, and
          // nothing falls through to a subcategory default the user overrode.
          pattern: details.pattern,
          patternScale: details.patternScale,
          materials: details.materials,
          sheen: details.sheen,
          styleTags: details.styleTags.map((tag) => ({ tag, weight: 1 })),
        },
        sub,
      );
      // Left busy on success: the caller navigates away, and a tap during the
      // transition would save twice.
    } catch (e) {
      inFlight.current = false;
      setSaving(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ThemedView style={styles.fill}>
      {/* iOS does not scroll a focused input clear of the keyboard on its own;
          the name field sits below two chip groups and was typed blind. */}
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {header}

        <View style={styles.section}>
          <ThemedText type="smallBold">What is it?</ThemedText>
          <ChipRow options={CATEGORY_OPTIONS} selected={category} onToggle={pickCategory} />
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">Which kind?</ThemedText>
          {subcategories ? (
            <ChipRow
              options={forCategory.map((s) => ({ value: s.code, label: s.label }))}
              selected={subcategory}
              onToggle={pickSub}
            />
          ) : subcategoriesFailed ? null : (
            <ActivityIndicator />
          )}
          {/* Shown, not asked. Makes it obvious what the answer bought. */}
          {sub ? (
            <ThemedText type="small" themeColor="textSecondary">
              Filled in from {sub.label.toLowerCase()}: warmth {sub.default_warmth}/5, layers as{' '}
              {sub.default_layer_role}, formality {sub.default_formality}/5.
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">Name it (optional)</ThemedText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="the good flannel"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Name"
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            maxLength={80}
          />
        </View>

        {sub && details ? (
          <View style={styles.section}>
            <Button
              variant="text"
              label={open ? 'Fewer details' : 'More details'}
              onPress={() => setOpen((o) => !o)}
              accessibilityHint="Pattern, material, finish and vibe tags"
              style={styles.toggle}
            />
            {open ? (
              <View style={styles.details}>
                <Field title="Pattern">
                  <ChipRow
                    options={PATTERN_OPTIONS}
                    selected={details.pattern}
                    onToggle={(p) =>
                      patch({ pattern: p, patternScale: scaleFor(p, details.patternScale) })
                    }
                  />
                </Field>
                {details.pattern !== 'solid' ? (
                  <Field title="Pattern size">
                    <ChipRow
                      options={SCALE_OPTIONS}
                      selected={details.patternScale}
                      onToggle={(s) => patch({ patternScale: s })}
                    />
                  </Field>
                ) : null}
                <Field title="Material">
                  <ChipRow
                    options={MATERIAL_OPTIONS}
                    selected={details.materials}
                    onToggle={(m) => patch({ materials: toggle(details.materials, m) })}
                  />
                </Field>
                <Field title="Finish" hint="Shiny means satin, metallic or patent.">
                  <ChipRow
                    options={SHEEN_OPTIONS}
                    selected={details.sheen}
                    onToggle={(s) => patch({ sheen: s })}
                  />
                </Field>
                <Field title="Vibe tags">
                  <ChipRow
                    options={TAG_OPTIONS}
                    selected={details.styleTags}
                    onToggle={(t) => patch({ styleTags: toggle(details.styleTags, t) })}
                  />
                </Field>
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {summary(details)}
              </ThemedText>
            )}
          </View>
        ) : null}

        {error ? <ThemedText themeColor="danger">{error}</ThemedText> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={submitLabel} onPress={submit} busy={saving} disabled={!sub} />
      </View>
    </ThemedView>
  );
}

function Field({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

/** Up to three colours read from the cutout. */
export function ColourSwatches({ palette }: { palette: Swatch[] }) {
  const theme = useTheme();
  return (
    <View style={styles.swatchRow}>
      {palette.slice(0, 3).map((s, i) => {
        const hex = rgbToHex(oklchToRgb(s));
        return (
          <View
            key={i}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Colour ${i + 1}: ${hex}`}
            style={[styles.swatch, { backgroundColor: hex, borderColor: theme.backgroundSelected }]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: {
    padding: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  section: { gap: Spacing.two },
  details: { gap: Spacing.four },
  toggle: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  footer: {
    padding: Spacing.four,
    paddingTop: 0,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  swatchRow: { flexDirection: 'row', gap: Spacing.two },
  swatch: { width: 40, height: 40, borderRadius: 10, borderWidth: 1 },
});
