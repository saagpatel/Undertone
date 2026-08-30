#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "tests/fixtures/rehearsal-hum.wav");
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
const totalSeconds =
	leadSeconds +
	notes.reduce((sum, note) => sum + note.seconds + gapSeconds, 0) +
	tailSeconds;
const frameCount = Math.ceil(totalSeconds * sampleRate);
const pcm = new Int16Array(frameCount);

let seed = 0x51a7f00d;
const noise = () => {
	seed ^= seed << 13;
	seed ^= seed >>> 17;
	seed ^= seed << 5;
	return ((seed >>> 0) / 0xffffffff) * 2 - 1;
};

let cursor = Math.floor(leadSeconds * sampleRate);
for (const note of notes) {
	const count = Math.floor(note.seconds * sampleRate);
	let phase = 0;
	for (let index = 0; index < count; index++) {
		const t = index / sampleRate;
		const position = index / count;
		const envelope = Math.min(1, position / 0.08, (1 - position) / 0.12);
		const vibratoCents = 1.5 * Math.sin(2 * Math.PI * 5.1 * t);
		const frequency = note.frequency * 2 ** (vibratoCents / 1200);
		phase += (2 * Math.PI * frequency) / sampleRate;
		const voiced =
			0.72 * Math.sin(phase) +
			0.06 * Math.sin(phase * 2) +
			0.02 * Math.sin(phase * 3);
		const sample = envelope * voiced + noise() * 0.0005;
		pcm[cursor + index] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
	}
	cursor += count + Math.floor(gapSeconds * sampleRate);
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

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, wav);
console.log(`${output} ${frameCount} frames ${totalSeconds.toFixed(2)} s`);
