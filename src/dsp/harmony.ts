import type { Key, Mode } from "./key";
import type { Accidental, NoteName, NoteValue, Phrase } from "./quantize";

/**
 * Functional harmonization: produces a diatonic {@link Chord[]} from a
 * {@link Phrase} and its detected {@link Key}.
 *
 * Algorithm:
 *  1. Slice the phrase into harmonic-rhythm slots (one per measure by default;
 *     per-beat fallback when the phrase is short or notes are sparse).
 *  2. For each slot, score every diatonic triad by how many of its tones appear
 *     in the melody notes that fall within that slot.
 *  3. Apply a functional bias (I/IV/V/i/iv/v get a bonus) so progressions
 *     avoid stagnating on weak-function chords.
 *  4. Force the final slot to the tonic (I/i) and the penultimate to V or IV
 *     (authentic or plagal cadence).
 *
 * All pure — same inputs always yield the same output. Never mutates the phrase.
 */

// ─── Exported types ───────────────────────────────────────────────────────────

export interface ChordTone {
	pitch: NoteName;
	accidental: Accidental;
}

export interface Chord {
	/** Roman-numeral label e.g. 'I', 'ii', 'IV', 'V', 'vi', 'vii°' */
	roman: string;
	/** Scale degree of the chord root (1–7). */
	degree: number;
	/** Triad quality — typed so chordSymbol() doesn't need to re-derive it. */
	quality: "major" | "minor" | "dim";
	root: ChordTone;
	/** Triad pitch classes in root position: [root, third, fifth]. */
	tones: ChordTone[];
	/** Human-readable chord symbol, e.g. 'C', 'Am', 'G', 'Bdim'. Always populated. */
	symbol: string;
	/** Quarter-note units from phrase start where this chord begins. */
	beatPosition: number;
	/** Duration in beats of this harmonic slot. */
	beats: number;
}

/**
 * Whether a phrase carries harmony to engrave. The single predicate that gates
 * grand-staff rendering and viewport growth, so the renderer, the export, and
 * the canvas can't drift on what "has chords" means. Narrows `chords` to a
 * non-empty `Chord[]` for callers.
 */
export function isHarmonized(chords: Chord[] | undefined): chords is Chord[] {
	return chords !== undefined && chords.length > 0;
}

// ─── Semitone helpers ─────────────────────────────────────────────────────────

const NATURAL_SEMITONES: Record<NoteName, number> = {
	C: 0,
	D: 2,
	E: 4,
	F: 5,
	G: 7,
	A: 9,
	B: 11,
};

function accidentalDelta(acc: Accidental): number {
	return acc === "sharp" ? 1 : acc === "flat" ? -1 : 0;
}

function toPitchClass(pitch: NoteName, accidental: Accidental): number {
	return (
		(((NATURAL_SEMITONES[pitch] + accidentalDelta(accidental)) % 12) + 12) % 12
	);
}

/** Convert semitone offset back to a NoteName + Accidental (sharp spelling). */
const PC_SPELLINGS: ReadonlyArray<{ pitch: NoteName; accidental: Accidental }> =
	[
		{ pitch: "C", accidental: null },
		{ pitch: "C", accidental: "sharp" },
		{ pitch: "D", accidental: null },
		{ pitch: "D", accidental: "sharp" },
		{ pitch: "E", accidental: null },
		{ pitch: "F", accidental: null },
		{ pitch: "F", accidental: "sharp" },
		{ pitch: "G", accidental: null },
		{ pitch: "G", accidental: "sharp" },
		{ pitch: "A", accidental: null },
		{ pitch: "A", accidental: "sharp" },
		{ pitch: "B", accidental: null },
	];

function pcToSpelling(pc: number): ChordTone {
	return { ...PC_SPELLINGS[(pc + 12) % 12] };
}

// ─── Scale construction ───────────────────────────────────────────────────────

/** Semitone intervals for major and natural minor scales. */
const SCALE_INTERVALS: Record<Mode, readonly number[]> = {
	major: [0, 2, 4, 5, 7, 9, 11],
	minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

/** Triad quality per scale degree (0-indexed) in major and minor. */
const TRIAD_QUALITIES: Record<
	Mode,
	ReadonlyArray<"major" | "minor" | "dim">
> = {
	major: ["major", "minor", "minor", "major", "major", "minor", "dim"],
	minor: ["minor", "dim", "major", "minor", "minor", "major", "major"],
};

/** Roman numeral labels per scale degree (0-indexed) in major and minor. */
const ROMAN_LABELS: Record<Mode, readonly string[]> = {
	major: ["I", "ii", "iii", "IV", "V", "vi", "vii°"],
	minor: ["i", "ii°", "III", "iv", "v", "VI", "VII"],
};

interface ScaleDegree {
	degree: number; // 1-based
	roman: string;
	quality: "major" | "minor" | "dim";
	/** Pitch classes of the root-position triad. */
	tones: ChordTone[];
	root: ChordTone;
}

/** Natural note letters in order, for letter-by-letter diatonic spelling. */
const LETTERS: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];

/**
 * Spell a given natural letter onto a target pitch class with the single
 * accidental that bends it there (or a natural when it already lands). For the
 * double-accidental case — unreachable within our single-accidental key
 * vocabulary — it falls back to the sharp enharmonic spelling.
 */
function spellLetter(letterIdx: number, targetPc: number): ChordTone {
	const pitch = LETTERS[((letterIdx % 7) + 7) % 7];
	const diff = (((targetPc - NATURAL_SEMITONES[pitch]) % 12) + 12) % 12;
	if (diff === 0) return { pitch, accidental: null };
	if (diff === 1) return { pitch, accidental: "sharp" };
	if (diff === 11) return { pitch, accidental: "flat" };
	return pcToSpelling(targetPc); // would need a double accidental — fall back
}

/**
 * Spell a diatonic scale degree by letter: the Nth degree always uses the Nth
 * letter up from the tonic letter (so C-major degree 3 is some kind of E, never
 * an enharmonic D#). Guarantees correct enharmonic spelling for every key within
 * the single-accidental vocabulary.
 */
function spellDiatonic(
	tonicLetterIdx: number,
	degreeIdx: number,
	targetPc: number,
): ChordTone {
	return spellLetter(tonicLetterIdx + degreeIdx, targetPc);
}

/**
 * Spell a root-position triad from a root letter and pitch class. Each tone
 * stacks a scale third — so the letters skip one each (root, +2, +4) and the
 * chosen `intervals` (semitone offsets above the root) bend them onto the right
 * pitch classes. Used for chromatic chords whose roots fall outside the home key.
 */
function spellTriad(
	rootLetterIdx: number,
	rootPc: number,
	intervals: readonly [number, number, number],
): ChordTone[] {
	return intervals.map((semitone, k) =>
		spellLetter(rootLetterIdx + 2 * k, (rootPc + semitone) % 12),
	);
}

/** Build all 7 diatonic scale degrees for a given key. */
function buildScale(key: Key): ScaleDegree[] {
	const tonicPc = toPitchClass(key.tonic, key.accidental);
	const tonicLetterIdx = LETTERS.indexOf(key.tonic);
	const intervals = SCALE_INTERVALS[key.mode];
	const qualities = TRIAD_QUALITIES[key.mode];
	const romans = ROMAN_LABELS[key.mode];

	// Spell the full diatonic scale first, one letter per degree.
	const scaleTones = intervals.map((interval, idx) =>
		spellDiatonic(tonicLetterIdx, idx, (tonicPc + interval) % 12),
	);

	// Each triad stacks scale thirds: degrees i, i+2, i+4 — so the letters skip
	// one each (C-E-G, D-F-A …) and the third/fifth spelling is correct by
	// construction, including the diminished triad (vii° = B-D-F, not B-D#-F).
	return intervals.map((_interval, idx) => {
		const tones: ChordTone[] = [
			scaleTones[idx],
			scaleTones[(idx + 2) % 7],
			scaleTones[(idx + 4) % 7],
		];
		return {
			degree: idx + 1,
			roman: romans[idx],
			quality: qualities[idx],
			tones,
			root: tones[0],
		};
	});
}

// ─── Functional bias weights ──────────────────────────────────────────────────

/**
 * Functional weight bonus for each scale degree (0-indexed).
 * I/IV/V (primary functions) get a larger bonus; ii/vi (pre-dominants) get a
 * small bonus; iii/vii° (weak functions) get none.
 */
const FUNCTIONAL_BIAS_MAJOR: readonly number[] = [
	0.3, // I
	0.1, // ii
	0.0, // iii
	0.2, // IV
	0.25, // V
	0.1, // vi
	0.0, // vii°
];

const FUNCTIONAL_BIAS_MINOR: readonly number[] = [
	0.3, // i
	0.0, // ii°
	0.0, // III
	0.2, // iv
	0.2, // v
	0.1, // VI
	0.1, // VII
];

function functionalBias(mode: Mode, degreeIndex: number): number {
	const table =
		mode === "major" ? FUNCTIONAL_BIAS_MAJOR : FUNCTIONAL_BIAS_MINOR;
	return table[degreeIndex] ?? 0;
}

// ─── Note-value beat lengths ──────────────────────────────────────────────────

const NOTE_BEATS: Record<NoteValue, number> = {
	whole: 4,
	half: 2,
	quarter: 1,
	eighth: 0.5,
	sixteenth: 0.25,
};

// ─── Slot construction ────────────────────────────────────────────────────────

interface Slot {
	startBeat: number;
	endBeat: number;
}

/**
 * Divide the phrase into harmonic slots.
 * Default: one slot per measure (4 beats). Falls back to per-beat slots when
 * fewer than 2 measures are present.
 */
function buildSlots(phrase: Phrase): Slot[] {
	if (phrase.notes.length === 0) return [];

	const beatsPerMeasure = phrase.timeSignatureNumerator;
	// Span to the latest-ending note, not the last in array order — harmonize is a
	// pure primitive and must not assume notes arrive sorted by beat position.
	const phraseEnd = Math.max(
		...phrase.notes.map((n) => n.beatPosition + NOTE_BEATS[n.noteValue]),
	);

	const numMeasures = Math.ceil(phraseEnd / beatsPerMeasure);

	// Use per-measure slots if ≥2 measures, otherwise per-beat slots.
	if (numMeasures >= 2) {
		return Array.from({ length: numMeasures }, (_, i) => ({
			startBeat: i * beatsPerMeasure,
			endBeat: Math.min((i + 1) * beatsPerMeasure, phraseEnd),
		}));
	}

	// Per-beat fallback for short phrases
	const numBeats = Math.max(1, Math.ceil(phraseEnd));
	return Array.from({ length: numBeats }, (_, i) => ({
		startBeat: i,
		endBeat: Math.min(i + 1, phraseEnd),
	}));
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/** Fraction of a triad's tones that appear in the slot's melody (0…1). */
function coverage(scale: ScaleDegree, melodyPCs: Set<number>): number {
	const triadPCs = scale.tones.map((t) => toPitchClass(t.pitch, t.accidental));
	return triadPCs.filter((pc) => melodyPCs.has(pc)).length / triadPCs.length;
}

/**
 * Score a scale degree for a given set of melody pitch classes.
 * = coverage (fraction of triad tones present in melody) + functional bias.
 */
function scoreChord(
	scale: ScaleDegree,
	melodyPCs: Set<number>,
	mode: Mode,
): number {
	return coverage(scale, melodyPCs) + functionalBias(mode, scale.degree - 1);
}

// ─── Chromatic harmony (opt-in) ───────────────────────────────────────────────

/**
 * A candidate chromatic chord — secondary dominant or borrowed — shaped like a
 * {@link ScaleDegree} so it flows through {@link makeChord} unchanged, plus the
 * pitch classes that lie OUTSIDE the home key. A candidate is only ever offered
 * for a slot whose melody contains one of those chromatic tones (the gate that
 * keeps chromatic colour off purely-diatonic melodies).
 */
interface ChromaticCandidate extends ScaleDegree {
	chromaticPCs: number[];
}

/**
 * Borrowed chords drawn from the PARALLEL mode (same tonic, opposite mode), by
 * the parallel scale's degree index, with the conventional roman relabel.
 * Major borrows the minor colours (iv, ♭VI, ♭VII); minor borrows the major IV
 * (the raised-6̂ subdominant). Each is still gated on melody support, so it only
 * surfaces when the melody actually implies its chromatic tone.
 */
const BORROWED_DEGREES: Record<
	Mode,
	ReadonlyArray<{ parallelDegree: number; roman: string }>
> = {
	major: [
		{ parallelDegree: 4, roman: "iv" }, // minor iv (♭6̂)
		{ parallelDegree: 6, roman: "♭VI" }, // ♭VI
		{ parallelDegree: 7, roman: "♭VII" }, // ♭VII (♭7̂)
	],
	// Minor needs no separate borrowed list: its chromatic palette is fully
	// covered by the secondary-dominant generator (the major V over the tonic
	// plus applied dominants like V/VII), which already emits the same triads a
	// parallel-major borrowing would — and earlier, so a borrowed entry here
	// would only ever be a shadowed, never-selected duplicate.
	minor: [],
};

/**
 * Small functional bonus for a melody-supported chromatic chord — enough to let
 * a well-covered applied/borrowed chord edge out a weak diatonic option, but not
 * so much that it overrides the melody. Sits between the weak (0.0) and
 * pre-dominant (0.1) diatonic biases.
 */
const CHROMATIC_BIAS = 0.1;

/** Pitch class of a {@link ChordTone}. */
function tonePC(t: ChordTone): number {
	return toPitchClass(t.pitch, t.accidental);
}

/**
 * Build every chromatic candidate for a key: secondary dominants (the major
 * triad a perfect fifth above each non-diminished diatonic root) plus parallel
 * mode borrowed chords. Candidates whose tones are all diatonic (e.g. V/I, V/IV
 * in major) are dropped — the chromatic-tone filter does that for free, which is
 * also what surfaces the major V (harmonic-minor dominant) in a minor key.
 */
function buildChromaticChords(
	scale: ScaleDegree[],
	key: Key,
): ChromaticCandidate[] {
	const diatonicPCs = new Set(scale.map((sd) => tonePC(sd.root)));
	const tonicLetterIdx = LETTERS.indexOf(key.tonic);
	const candidates: ChromaticCandidate[] = [];

	// Secondary dominants — tonicize each major/minor diatonic degree.
	for (const target of scale) {
		if (target.quality === "dim") continue; // diminished triads aren't tonicized
		const targetRootPc = tonePC(target.root);
		const domRootPc = (targetRootPc + 7) % 12; // a perfect fifth above
		const domRootLetterIdx = (LETTERS.indexOf(target.root.pitch) + 4) % 7;
		const tones = spellTriad(domRootLetterIdx, domRootPc, [0, 4, 7]); // major
		const chromaticPCs = tones.map(tonePC).filter((pc) => !diatonicPCs.has(pc));
		if (chromaticPCs.length === 0) continue; // dominant is diatonic — skip
		candidates.push({
			degree: ((domRootLetterIdx - tonicLetterIdx + 7) % 7) + 1,
			// Tonicizing the tonic IS the primary dominant (major V in minor) — "V";
			// every other target is an applied dominant "V/x".
			roman: target.degree === 1 ? "V" : `V/${target.roman}`,
			quality: "major",
			tones,
			root: tones[0],
			chromaticPCs,
		});
	}

	// Borrowed chords — pull spelled triads straight from the parallel scale.
	const parallelMode: Mode = key.mode === "major" ? "minor" : "major";
	const parallelScale = buildScale({ ...key, mode: parallelMode });
	for (const spec of BORROWED_DEGREES[key.mode]) {
		const sd = parallelScale[spec.parallelDegree - 1];
		const chromaticPCs = sd.tones
			.map(tonePC)
			.filter((pc) => !diatonicPCs.has(pc));
		if (chromaticPCs.length === 0) continue; // already diatonic — not borrowed
		candidates.push({
			degree: sd.degree,
			roman: spec.roman,
			quality: sd.quality,
			tones: sd.tones,
			root: sd.root,
			chromaticPCs,
		});
	}

	return candidates;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Options controlling {@link harmonize}. */
export interface HarmonizeOptions {
	/**
	 * Opt into chromatic harmony — secondary dominants + borrowed chords, each
	 * offered only where a melody note supports the chromatic tone. Default
	 * `false`: strict diatonic, byte-identical to the v2 output.
	 */
	chromatic?: boolean;
}

/**
 * Harmonize a {@link Phrase} given its detected {@link Key}.
 *
 * Returns an empty array for an empty phrase.
 * Always ends with a tonic chord (I/i) preceded by a dominant/subdominant
 * (authentic or plagal cadence).
 *
 * With `opts.chromatic`, free (non-cadence) slots may also pick a melody-gated
 * secondary dominant or borrowed chord; the forced cadence stays diatonic, and
 * a purely diatonic melody yields output identical to the default path.
 */
export function harmonize(
	phrase: Phrase,
	key: Key,
	opts?: HarmonizeOptions,
): Chord[] {
	if (phrase.notes.length === 0) return [];

	const scale = buildScale(key);
	const slots = buildSlots(phrase);
	const chromaticChords = opts?.chromatic
		? buildChromaticChords(scale, key)
		: [];

	const tonicDegree = scale[0]; // I or i
	const dominantDegree = scale[4]; // V or v
	const subdominantDegree = scale[3]; // IV or iv

	const result: Chord[] = [];

	for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
		const slot = slots[slotIdx];
		const isLastSlot = slotIdx === slots.length - 1;
		const isPenultimate = slotIdx === slots.length - 2;

		// Pitch classes of the melody notes that fall within this slot.
		const melodyPCs = new Set(
			phrase.notes
				.filter(
					(n) =>
						n.beatPosition >= slot.startBeat && n.beatPosition < slot.endBeat,
				)
				.map((n) => toPitchClass(n.pitch, n.accidental)),
		);

		// Final slot → tonic. Resolves the cadence.
		if (isLastSlot) {
			result.push(makeChord(tonicDegree, slot, key));
			continue;
		}

		// Penultimate slot → dominant or subdominant, whichever better covers the
		// melody here: authentic (V→I) vs plagal (IV→I). Prefer V on a tie.
		if (isPenultimate && slots.length >= 2) {
			const cadence =
				coverage(subdominantDegree, melodyPCs) >
				coverage(dominantDegree, melodyPCs)
					? subdominantDegree
					: dominantDegree;
			result.push(makeChord(cadence, slot, key));
			continue;
		}

		// Free slot → highest-scoring diatonic chord (coverage + functional bias).
		let bestScale: ScaleDegree = scale[0];
		let bestScore = -Infinity;
		for (const sd of scale) {
			const score = scoreChord(sd, melodyPCs, key.mode);
			if (score > bestScore) {
				bestScore = score;
				bestScale = sd;
			}
		}

		// …then let any melody-supported chromatic chord compete. A candidate is
		// eligible only when the melody here contains one of its chromatic tones,
		// so chromatic colour never appears against a purely diatonic melody. The
		// strict `>` keeps diatonic the tie-winner — default output is unchanged.
		for (const cand of chromaticChords) {
			if (!cand.chromaticPCs.some((pc) => melodyPCs.has(pc))) continue;
			const score = coverage(cand, melodyPCs) + CHROMATIC_BIAS;
			if (score > bestScore) {
				bestScore = score;
				bestScale = cand;
			}
		}

		result.push(makeChord(bestScale, slot, key));
	}

	return result;
}

function makeChord(sd: ScaleDegree, slot: Slot, key: Key): Chord {
	return {
		roman: sd.roman,
		degree: sd.degree,
		quality: sd.quality,
		root: sd.root,
		tones: sd.tones,
		symbol: chordSymbol(sd, key),
		beatPosition: slot.startBeat,
		beats: slot.endBeat - slot.startBeat,
	};
}

// ─── Chord symbol formatting ──────────────────────────────────────────────────

/**
 * Format a {@link Chord} as a human-readable chord symbol (e.g. `C`, `Am`, `G`).
 * Uses `chord.quality` directly — no string-case detection.
 */
export function chordSymbol(
	chord: Pick<Chord, "root" | "quality">,
	_key: Key,
): string {
	const { pitch, accidental } = chord.root;
	const accStr =
		accidental === "sharp" ? "#" : accidental === "flat" ? "b" : "";
	const qualitySuffix =
		chord.quality === "dim" ? "dim" : chord.quality === "minor" ? "m" : "";
	return `${pitch}${accStr}${qualitySuffix}`;
}
