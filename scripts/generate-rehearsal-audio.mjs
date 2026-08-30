#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sampleRate = 48_000;
const notes = [
	{ frequency: 440, seconds: 0.42 },
	{ frequency: 493.88, seconds: 0.42 },
	{ frequency: 523.25, seconds: 0.42 },
	{ frequency: 587.33, seconds: 0.56 },
];
const leadSeconds = 0.2;
const gapSeconds = 0.14;
const tailSeconds = 0.3;
const variants = [
	{
		name: "rehearsal-hum.wav",
		breathNoise: 0.012,
		vibratoCents: 13,
		glideCents: 8,
		gapScale: 1,
		seed: 0x51a7f00d,
	},
	{
		name: "rehearsal-hum-breathy.wav",
		breathNoise: 0.055,
		vibratoCents: 21,
		glideCents: 14,
		gapScale: 1.12,
		seed: 0x0b7ea7e5,
	},
	{
		name: "rehearsal-hum-slides.wav",
		breathNoise: 0.018,
		vibratoCents: 16,
		glideCents: 52,
		gapScale: 0.86,
		seed: 0x0511de55,
	},
];

function makeNoise(initialSeed) {
	let seed = initialSeed;
	return () => {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		return ((seed >>> 0) / 0xffffffff) * 2 - 1;
	};
}

function writeVariant(variant) {
	const adjustedTotalSeconds =
		leadSeconds +
		notes.reduce(
			(sum, note) => sum + note.seconds + gapSeconds * variant.gapScale,
			0,
		) +
		tailSeconds;
	const frameCount = Math.ceil(adjustedTotalSeconds * sampleRate);
	const pcm = new Int16Array(frameCount);
	const noise = makeNoise(variant.seed);
	let cursor = Math.floor(leadSeconds * sampleRate);

	for (const [noteIndex, note] of notes.entries()) {
		const count = Math.floor(note.seconds * sampleRate);
		let phase = 0;
		for (let index = 0; index < count; index++) {
			const t = index / sampleRate;
			const absoluteTime = cursor / sampleRate + t;
			const position = index / count;
			const envelope = Math.max(
				0,
				Math.min(1, position / 0.09, (1 - position) / 0.14),
			);
			const cents =
				variant.vibratoCents * Math.sin(2 * Math.PI * 5.2 * absoluteTime) +
				variant.glideCents * (position - 0.5) +
				(noteIndex % 2 === 0 ? -2 : 2);
			const frequency = note.frequency * 2 ** (cents / 1200);
			phase += (2 * Math.PI * frequency) / sampleRate;
			const amplitudeMotion =
				0.93 + 0.07 * Math.sin(2 * Math.PI * 2.05 * absoluteTime);
			const voiced =
				0.62 * Math.sin(phase) +
				0.2 * Math.sin(phase * 2 + 0.18) +
				0.09 * Math.sin(phase * 3 + 0.37) +
				0.04 * Math.sin(phase * 4 + 0.61);
			const sample =
				envelope * amplitudeMotion * voiced + noise() * variant.breathNoise;
			pcm[cursor + index] = Math.round(
				Math.max(-1, Math.min(1, sample)) * 32767,
			);
		}
		cursor += count + Math.floor(gapSeconds * variant.gapScale * sampleRate);
	}

	const dataBytes = pcm.byteLength;
	const wav = Buffer.alloc(44 + dataBytes);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(36 + dataBytes, 4);
	wav.write("WAVE", 8);
	wav.write("fmt ", 12);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(dataBytes, 40);
	Buffer.from(pcm.buffer).copy(wav, 44);
	const output = resolve(root, "tests/fixtures", variant.name);
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, wav);
	console.log(
		`${output} ${frameCount} frames ${adjustedTotalSeconds.toFixed(2)} s`,
	);
}

for (const variant of variants) writeVariant(variant);
