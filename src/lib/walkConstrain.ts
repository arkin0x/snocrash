/**
 * walkConstrain.ts - a shard's WALK setting (DECK-0003 §1.12; arkinox,
 * 2026-10-23: "ALL shards should publish with the OPAQUE option on by
 * default").
 *
 * `constrain` in a payload says whether a walker can cross the object's
 * faces: `all` for every face, `opaque` for the faces of an object drawn
 * solid and fully opaque, `off` for none. snocrash never walks anyone, so it
 * only sets the field, in the workshop, and publishes it; ONOSENDAI's WALK is
 * where it holds a walker (ONOSENDAI lib/walkConstrain.ts, the same names).
 * sno-core does not know the field, so it rides in the model's `extra`,
 * carried through every read, edit and write untouched; this module is the
 * only place that reads or writes it.
 *
 * | The payload says | A walker meets (readConstrain) | The workshop shows and publishes (authoredConstrain) |
 * |---|---|---|
 * | `all` / `opaque` / `off` | that | that |
 * | nothing | off: every object published before the default keeps its meaning | opaque: nobody chose, so the default |
 * | anything else | off | opaque: not a choice either |
 *
 * So OFF is written as `"off"`, never as no field, or the next publish would
 * turn it to OPAQUE. Every object this app publishes goes through
 * withAuthoredConstrain (store/useNostr.ts objectTemplate).
 */

import type { ShardModel } from 'sno-core/shards'

/** What a shard asks of a walker. */
export type Constrain = 'off' | 'all' | 'opaque'

/** What a shard whose author has not chosen publishes as (DECK-0003 §1.12). */
export const CONSTRAIN_DEFAULT: Constrain = 'opaque'

/** The three settings, in the order the controls show them. */
export const CONSTRAINS: readonly Constrain[] = ['off', 'all', 'opaque']

/** Each setting's tooltip, as ONOSENDAI's. */
export const CONSTRAIN_TIPS: Readonly<Record<Constrain, string>> = {
  off: 'WALK passes through',
  all: 'WALK cannot cross any face',
  opaque: 'WALK cannot cross it while solid and opaque',
}

/** The payload field (DECK-0003 §1.12). */
export const CONSTRAIN_FIELD = 'constrain'

/** A payload's `constrain`, read as §1.12 has a walker read it: `all` or `opaque` exactly, and anything else, `off` and absent included, is off. */
export function readConstrain(raw: unknown): Constrain {
  return raw === 'all' || raw === 'opaque' ? raw : 'off'
}

/** A payload's `constrain` as its author chose it: one of the three words exactly, and anything else, absent included, the default (§1.12). */
export function authoredConstrain(raw: unknown): Constrain {
  return raw === 'all' || raw === 'opaque' || raw === 'off' ? raw : CONSTRAIN_DEFAULT
}

/**
 * The raw field. A top-level `constrain` is read first, for a sno-core that
 * has learned the field and lifted it out of `extra`; walkConstrain.test.ts
 * fails the day that happens, so the writer here learns it too.
 */
function rawConstrain(s: Pick<ShardModel, 'extra'>): unknown {
  const top = (s as { constrain?: unknown }).constrain
  return top !== undefined ? top : s.extra?.[CONSTRAIN_FIELD]
}

/** A model's setting as a walker meets it. */
export function constrainOf(s: Pick<ShardModel, 'extra'>): Constrain {
  return readConstrain(rawConstrain(s))
}

/** A model's setting as the workshop shows it, and as it publishes: OPAQUE when its author has not chosen. */
export function authoredConstrainOf(s: Pick<ShardModel, 'extra'>): Constrain {
  return authoredConstrain(rawConstrain(s))
}

/**
 * `s` with its setting at `c`, written as the word itself: OFF is `"off"`,
 * never no field, so a deliberate OFF survives the default (§1.12). The
 * same object when it already says exactly that; a malformed value is
 * replaced.
 */
export function withConstrain<T extends ShardModel>(s: T, c: Constrain): T {
  if (s.extra?.[CONSTRAIN_FIELD] === c) return s
  const { extra, ...rest } = s
  const kept: Array<[string, unknown]> = extra ? Object.entries(extra).filter(([k]) => k !== CONSTRAIN_FIELD) : []
  kept.push([CONSTRAIN_FIELD, c])
  return { ...rest, extra: Object.fromEntries(kept) } as T
}

/**
 * `s` as it publishes: its author's word kept, and OPAQUE written for a shard
 * whose author never chose (a new one, one published before the default, an
 * import without the field). The same object when it already carries a word.
 */
export function withAuthoredConstrain<T extends ShardModel>(s: T): T {
  return withConstrain(s, authoredConstrainOf(s))
}
