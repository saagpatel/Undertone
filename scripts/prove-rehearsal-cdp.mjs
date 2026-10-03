#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.UNDERTONE_PROOF_PORT ?? 5174);
const ORIGIN = `http://localhost:${PORT}`;
const DEBUG_PORT = Number(process.env.UNDERTONE_DEBUG_PORT ?? 9334);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VITE = resolve(ROOT, "node_modules/vite/bin/vite.js");
const AUDIO = resolve(ROOT, "tests/fixtures/rehearsal-hum.wav");
const OUTPUT = resolve(ROOT, "artifacts/rehearsal-proof");
const SUSTAINED_TAKES = Number(process.env.UNDERTONE_SUSTAINED_TAKES ?? 12);
if (!Number.isInteger(SUSTAINED_TAKES) || SUSTAINED_TAKES < 12) {
	throw new Error(
		"UNDERTONE_SUSTAINED_TAKES must be an integer of at least 12",
	);
}
const PROFILE = mkdtempSync(join(tmpdir(), "undertone-rehearsal-"));

const SYNTHETIC_MIC_SCRIPT = `
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia: async () => {
      for (const prior of window.__undertoneFixtureContexts ?? []) {
        try { await prior.close(); } catch {}
      }
      const context = new AudioContext({ sampleRate: 48000 });
      await context.resume();
      const destination = context.createMediaStreamDestination();
      const notes = [440, 493.88, 523.25, 587.33];
	  const mode = window.__undertoneMicMode ?? 'clean';
      const limited = mode === 'limited';
	  const pitchScale = mode === 'transposed' ? 2 ** (2 / 12) : 1;
      let start = context.currentTime + 0.12;
	  const wavPath = mode === 'wav-breathy'
	    ? '/tests/fixtures/rehearsal-hum-breathy.wav'
	    : mode === 'wav-slides'
	      ? '/tests/fixtures/rehearsal-hum-slides.wav'
	      : null;
	  if (wavPath) {
	    const response = await fetch(wavPath);
	    if (!response.ok) throw new Error('Unable to load project-owned WAV fixture');
	    const buffer = await context.decodeAudioData(await response.arrayBuffer());
	    const source = context.createBufferSource();
	    source.buffer = buffer;
	    source.connect(destination);
	    source.start(start);
	    start += buffer.duration;
	  } else if (mode !== 'silent') {
        for (const [index, frequency] of notes.entries()) {
          const duration = index === notes.length - 1 ? 0.56 : 0.42;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = 'sine';
		  oscillator.frequency.setValueAtTime(frequency * pitchScale, start);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.42, start + 0.025);
          gain.gain.setValueAtTime(0.42, start + duration - 0.04);
          gain.gain.linearRampToValueAtTime(0, start + duration);
          oscillator.connect(gain).connect(destination);
          oscillator.start(start);
          oscillator.stop(start + duration + 0.01);
          start += duration + 0.14;
		}
      }
      if (limited) {
        const length = Math.ceil(context.sampleRate * (start - context.currentTime));
        const noiseBuffer = context.createBuffer(1, length, context.sampleRate);
        const channel = noiseBuffer.getChannelData(0);
        let state = 0x12345678;
        for (let index = 0; index < channel.length; index += 1) {
          state = (1664525 * state + 1013904223) >>> 0;
          channel[index] = (state / 0xffffffff) * 2 - 1;
        }
        const noise = context.createBufferSource();
        const noiseGain = context.createGain();
        noise.buffer = noiseBuffer;
        noiseGain.gain.value = 0.16;
        noise.connect(noiseGain).connect(destination);
        noise.start(context.currentTime + 0.04);
      }
      window.__undertoneFixtureContexts = [context];
      window.__undertoneFixtureStreams = [
        ...(window.__undertoneFixtureStreams ?? []),
        destination.stream,
      ];
      return destination.stream;
    },
  },
});
`;

const delay = (ms) =>
	new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function check(label, condition, detail = "") {
	if (!condition) throw new Error(`${label}: ${detail}`);
	console.log(`  [PASS] ${label}${detail ? ` (${detail})` : ""}`);
}

function percentile(values, percentileValue) {
	const sorted = [...values].sort((left, right) => left - right);
	if (sorted.length === 0) return null;
	const index = Math.min(
		sorted.length - 1,
		Math.ceil((percentileValue / 100) * sorted.length) - 1,
	);
	return sorted[Math.max(0, index)];
}

async function waitForJson(url, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return await response.json();
		} catch {
			// Chrome is still starting.
		}
		await delay(100);
	}
	throw new Error(`Timed out waiting for ${url}`);
}

async function waitForHttp(url, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Vite is still starting.
		}
		await delay(100);
	}
	throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
	constructor(url) {
		this.socket = new WebSocket(url);
		this.nextId = 1;
		this.pending = new Map();
		this.listeners = new Map();
		this.ready = new Promise((resolveReady, rejectReady) => {
			this.socket.addEventListener("open", resolveReady, { once: true });
			this.socket.addEventListener("error", rejectReady, { once: true });
		});
		this.socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id) {
				const pending = this.pending.get(message.id);
				if (!pending) return;
				this.pending.delete(message.id);
				if (message.error) pending.reject(new Error(message.error.message));
				else pending.resolve(message.result);
				return;
			}
			for (const listener of this.listeners.get(message.method) ?? []) {
				listener(message.params ?? {});
			}
		});
	}

	on(method, listener) {
		const listeners = this.listeners.get(method) ?? [];
		listeners.push(listener);
		this.listeners.set(method, listeners);
	}

	async send(method, params = {}) {
		await this.ready;
		const id = this.nextId++;
		const response = new Promise((resolveResponse, rejectResponse) => {
			this.pending.set(id, {
				resolve: resolveResponse,
				reject: rejectResponse,
			});
		});
		this.socket.send(JSON.stringify({ id, method, params }));
		return response;
	}

	close() {
		this.socket.close();
	}
}

async function newPage(url = "about:blank") {
	const target = await fetch(
		`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`,
		{ method: "PUT" },
	).then((response) => response.json());
	const cdp = new Cdp(target.webSocketDebuggerUrl);
	await cdp.ready;
	await Promise.all([
		cdp.send("Page.enable"),
		cdp.send("Runtime.enable"),
		cdp.send("Network.enable"),
		cdp.send("Log.enable"),
	]);
	return cdp;
}

async function evaluate(cdp, expression) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.text ?? "Runtime evaluation failed",
		);
	}
	return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await evaluate(cdp, expression)) return;
		await delay(80);
	}
	throw new Error(`Timed out waiting for: ${expression}`);
}

async function clickButton(cdp, label) {
	const clicked = await evaluate(
		cdp,
		`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true; })()`,
	);
	if (!clicked) throw new Error(`Button not found: ${label}`);
}

async function navigate(cdp, url = ORIGIN) {
	await cdp.send("Page.navigate", { url });
	await waitFor(cdp, "document.readyState === 'complete'", 10_000);
	await waitFor(
		cdp,
		"document.querySelector('h1')?.textContent === 'Undertone'",
		10_000,
	);
}

async function screenshot(cdp, filename) {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: true,
		fromSurface: true,
	});
	writeFileSync(resolve(OUTPUT, filename), Buffer.from(data, "base64"));
}

async function captureTake(cdp, durationMs = 2650) {
	const hasStart = await evaluate(
		cdp,
		`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Start humming')`,
	);
	await clickButton(cdp, hasStart ? "Start humming" : "Hum again");
	await waitFor(
		cdp,
		`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Stop')`,
	);
	await delay(durationMs);
	const started = performance.now();
	await clickButton(cdp, "Stop");
	await waitFor(
		cdp,
		`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Hum again')`,
		3000,
	);
	return performance.now() - started;
}

function sampleMacEnergy(profile) {
	const processLines = execFileSync("ps", ["-axo", "pid=,command="], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((line) => line.includes(profile));
	const pids = processLines
		.map((line) => line.trim().split(/\s+/, 1)[0])
		.filter(Boolean);
	if (pids.length === 0)
		return { processCount: 0, relativePower: null, raw: "" };
	const args = ["-l", "2", "-s", "1"];
	for (const pid of pids) args.push("-pid", pid);
	args.push("-stats", "pid,cpu,mem,power");
	const raw = execFileSync("top", args, { encoding: "utf8" });
	const lastRows = new Map();
	for (const line of raw.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+([\d.]+)\s+\S+\s+([\d.]+)\s*$/);
		if (match)
			lastRows.set(match[1], {
				cpu: Number(match[2]),
				power: Number(match[3]),
			});
	}
	return {
		processCount: pids.length,
		relativePower: [...lastRows.values()].reduce(
			(sum, process) => sum + process.power,
			0,
		),
		cpuPercent: [...lastRows.values()].reduce(
			(sum, process) => sum + process.cpu,
			0,
		),
		raw,
	};
}

let server = null;
let chrome = null;

try {
	mkdirSync(OUTPUT, { recursive: true });
	server = spawn(
		process.execPath,
		[VITE, "--port", String(PORT), "--strictPort"],
		{ cwd: ROOT, stdio: "ignore" },
	);
	chrome = spawn(
		CHROME,
		[
			"--headless=new",
			`--remote-debugging-port=${DEBUG_PORT}`,
			"--remote-allow-origins=*",
			`--user-data-dir=${PROFILE}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--use-fake-ui-for-media-stream",
			"--use-fake-device-for-media-stream",
			`--use-file-for-fake-audio-capture=${AUDIO}`,
			"--autoplay-policy=no-user-gesture-required",
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	await waitForHttp(ORIGIN);
	await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
	const page = await newPage();
	await page.send("Page.addScriptToEvaluateOnNewDocument", {
		source: SYNTHETIC_MIC_SCRIPT,
	});
	const requests = [];
	const errors = [];
	page.on("Network.requestWillBeSent", ({ request }) =>
		requests.push(request.url),
	);
	page.on("Runtime.exceptionThrown", ({ exceptionDetails }) =>
		errors.push(exceptionDetails.text ?? "runtime exception"),
	);
	page.on("Log.entryAdded", ({ entry }) => {
		if (entry.level === "error") errors.push(entry.text);
	});
	await navigate(page);

	check(
		"rehearsal is an explicit named region",
		await evaluate(
			page,
			`document.querySelector('#rehearsal-title')?.textContent === 'Rehearsal loop'`,
		),
	);
	check(
		"baseline action starts disabled",
		await evaluate(
			page,
			`[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Use this take as baseline')?.disabled === true`,
		),
	);

	const firstStopMs = await captureTake(page);
	const noteCount = await evaluate(
		page,
		`document.querySelectorAll('.notation ellipse[data-note-index]').length`,
	);
	const firstBody = await evaluate(page, `document.body.innerText`);
	check(
		"fixture reaches the real microphone flow",
		noteCount >= 3,
		`${noteCount} notes; ${firstBody.replace(/\s+/g, " ").slice(0, 420)}`,
	);
	check(
		"capture evidence becomes visible",
		await evaluate(
			page,
			`document.body.innerText.includes('Current take') && document.body.innerText.includes('analysis')`,
		),
	);
	await clickButton(page, "Use this take as baseline");
	await waitFor(
		page,
		`document.querySelector('.rehearsal-contour svg') !== null`,
	);
	check(
		"target contour and playback are available",
		await evaluate(
			page,
			`document.body.innerText.includes('Target contour ready') && document.body.innerText.includes('Hear target')`,
		),
	);

	await evaluate(page, `window.__undertoneMicMode = 'transposed'`);
	const repeatStopMs = await captureTake(page);
	await waitFor(
		page,
		`document.body.innerText.includes('Take-to-take comparison')`,
		3000,
	);
	const body = await evaluate(page, `document.body.innerText`);
	for (const [label, phrase] of [
		["repeat closes the loop", "matched notes"],
		["global pitch metric is visible", "Overall pitch shift"],
		["local pitch metric is visible", "Local pitch variation"],
		["tempo-relative metric is visible", "Inferred pace"],
		["onset uncertainty is visible", "capture uncertainty"],
	]) {
		check(label, body.toLowerCase().includes(phrase.toLowerCase()));
	}
	check("transposed repeat is identified", body.includes("+2 semitones"));
	check(
		"health and learning claim boundary is visible",
		body.toLowerCase().includes("do not assess vocal health") &&
			body.toLowerCase().includes("demonstrated learning"),
	);
	check(
		"session retention boundary is visible",
		body.includes("clears on reload or Reset"),
	);
	check(
		"ordinary note gaps do not become a material unvoiced warning",
		!body.includes("The take includes unvoiced or silent sections."),
	);

	await clickButton(page, "Hear target");
	await delay(250);
	check(
		"playback advances a synchronized contour playhead",
		await evaluate(
			page,
			`document.querySelector('.contour-playhead') !== null`,
		),
	);
	await clickButton(page, "Stop target");

	await page.send("Performance.enable");
	const metricResponse = await page.send("Performance.getMetrics");
	const metricMap = Object.fromEntries(
		metricResponse.metrics.map((metric) => [metric.name, metric.value]),
	);
	const ax = await page.send("Accessibility.getFullAXTree");
	const axNames = ax.nodes
		.map((node) => node.name?.value)
		.filter((name) => typeof name === "string");
	for (const name of [
		"Rehearsal loop",
		"Hear target",
		"Reset rehearsal",
		"Take-to-take comparison",
	]) {
		check(`accessibility tree names ${name}`, axNames.includes(name));
	}

	const heap = metricMap.JSHeapUsedSize ?? 0;
	check(
		"repeat stop-to-render latency stays bounded",
		repeatStopMs < 500,
		`${repeatStopMs.toFixed(1)} ms`,
	);
	check(
		"browser heap stays bounded",
		heap < 64 * 1024 * 1024,
		`${(heap / 1024 / 1024).toFixed(1)} MiB`,
	);

	const sustained = [];
	const sustainedModes = ["clean", "transposed", "limited"];
	await page.send("HeapProfiler.enable");
	for (let index = 0; index < SUSTAINED_TAKES; index += 1) {
		const mode = sustainedModes[index % sustainedModes.length];
		await evaluate(page, `window.__undertoneMicMode = ${JSON.stringify(mode)}`);
		const stopToRenderMs = await captureTake(page);
		const liveTracks = await evaluate(
			page,
			`(window.__undertoneFixtureStreams ?? []).flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === 'live').length`,
		);
		const beforeGcMetrics = await page.send("Performance.getMetrics");
		const beforeGcMap = Object.fromEntries(
			beforeGcMetrics.metrics.map((metric) => [metric.name, metric.value]),
		);
		await page.send("HeapProfiler.collectGarbage");
		const cycleMetrics = await page.send("Performance.getMetrics");
		const cycleMap = Object.fromEntries(
			cycleMetrics.metrics.map((metric) => [metric.name, metric.value]),
		);
		sustained.push({
			cycle: index + 1,
			mode,
			stopToRenderMs,
			jsHeapUsedBeforeGcBytes: beforeGcMap.JSHeapUsedSize ?? null,
			domNodesBeforeGc: beforeGcMap.Nodes ?? null,
			jsHeapUsedBytes: cycleMap.JSHeapUsedSize ?? null,
			domNodes: cycleMap.Nodes ?? null,
			liveTracksAfterStop: liveTracks,
		});
	}
	const sustainedLatencies = sustained.map((cycle) => cycle.stopToRenderMs);
	const sustainedHeaps = sustained
		.map((cycle) => cycle.jsHeapUsedBytes)
		.filter((value) => Number.isFinite(value));
	const sustainedNodes = sustained
		.map((cycle) => cycle.domNodes)
		.filter((value) => Number.isFinite(value));
	const latencyP50 = percentile(sustainedLatencies, 50);
	const latencyP95 = percentile(sustainedLatencies, 95);
	const firstHeap = sustainedHeaps[0] ?? heap;
	const lastHeap = sustainedHeaps.at(-1) ?? heap;
	const heapDelta = lastHeap - firstHeap;
	const domNodeSpread =
		sustainedNodes.length === 0
			? null
			: Math.max(...sustainedNodes) - Math.min(...sustainedNodes);
	check(
		"sustained stop-to-render p95 stays bounded",
		latencyP95 !== null && latencyP95 < 500,
		`${latencyP95?.toFixed(1)} ms across ${SUSTAINED_TAKES} takes`,
	);
	check(
		"sustained heap growth stays bounded",
		heapDelta < 16 * 1024 * 1024 &&
			Math.max(...sustainedHeaps) < 64 * 1024 * 1024,
		`${(heapDelta / 1024 / 1024).toFixed(1)} MiB first-to-last`,
	);
	check(
		"sustained DOM stays structurally stable",
		domNodeSpread !== null && domNodeSpread < 160,
		`${domNodeSpread} node spread`,
	);
	const wavVariants = [];
	for (const [mode, expectedName] of [
		["wav-breathy", "breathy"],
		["wav-slides", "sliding"],
	]) {
		await evaluate(page, `window.__undertoneMicMode = ${JSON.stringify(mode)}`);
		await captureTake(page, 3_250);
		const quality = await evaluate(
			page,
			`[...document.querySelectorAll('.rehearsal-quality')].at(-1)?.innerText ?? ''`,
		);
		const noteMatch = quality.match(/(\d+) notes/);
		const noteCountForVariant = Number(noteMatch?.[1] ?? 0);
		check(
			`${expectedName} WAV reaches the browser capture flow`,
			noteCountForVariant >= 3 && noteCountForVariant <= 5,
			quality.replace(/\s+/g, " "),
		);
		wavVariants.push({ mode, noteCount: noteCountForVariant, quality });
	}
	const historicalLiveTracks = await evaluate(
		page,
		`(window.__undertoneFixtureStreams ?? []).flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === 'live').length`,
	);
	check(
		"every historical microphone track is released after stop",
		sustained.every((cycle) => cycle.liveTracksAfterStop === 0) &&
			historicalLiveTracks === 0,
	);
	const offsite = requests.filter((url) => !url.startsWith(ORIGIN));
	check(
		"rehearsal makes zero off-origin requests",
		offsite.length === 0,
		offsite.slice(0, 3).join(", "),
	);
	check(
		"rehearsal emits no browser errors",
		errors.length === 0,
		errors.slice(0, 3).join("; "),
	);
	await screenshot(page, "rehearsal-desktop.png");

	await clickButton(page, "Reset rehearsal");
	await evaluate(page, `window.__undertoneMicMode = 'limited'`);
	await captureTake(page);
	const limitedBody = await evaluate(page, `document.body.innerText`);
	check(
		"noisy capture evidence is understandable in the real flow",
		limitedBody.includes("limited evidence") &&
			(limitedBody.includes("low-confidence pitched frames") ||
				limitedBody.includes("noisy frames")),
		limitedBody.replace(/\s+/g, " ").slice(0, 520),
	);
	await screenshot(page, "rehearsal-limited-evidence.png");

	await evaluate(page, `window.__undertoneMicMode = 'silent'`);
	await captureTake(page);
	const silentBody = await evaluate(page, `document.body.innerText`);
	check(
		"silent capture reaches an explicit insufficient-audio state",
		silentBody.includes("insufficient evidence") &&
			silentBody.includes("0 notes") &&
			silentBody.includes("No notes caught"),
		silentBody.replace(/\s+/g, " ").slice(0, 520),
	);

	const mobile = await newPage();
	await mobile.send("Emulation.setDeviceMetricsOverride", {
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		mobile: true,
	});
	await navigate(mobile);
	check(
		"mobile layout has no horizontal overflow",
		await evaluate(
			mobile,
			`document.documentElement.scrollWidth <= innerWidth`,
		),
	);
	await screenshot(mobile, "rehearsal-mobile-empty.png");
	mobile.close();

	for (const [name, expected] of [
		["NotAllowedError", "permission was denied"],
		["NotReadableError", "unavailable or already in use"],
	]) {
		const failure = await newPage();
		await failure.send("Page.addScriptToEvaluateOnNewDocument", {
			source: `Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('fixture', ${JSON.stringify(name)}); } } });`,
		});
		await navigate(failure);
		await clickButton(failure, "Start humming");
		await waitFor(failure, `document.querySelector('[role=alert]') !== null`);
		const alert = await evaluate(
			failure,
			`document.querySelector('[role=alert]').textContent.toLowerCase()`,
		);
		check(
			`${name} has distinct recovery copy`,
			alert.includes(expected),
			alert,
		);
		failure.close();
	}

	await evaluate(page, `window.__undertoneMicMode = 'clean'`);
	await clickButton(page, "Hum again");
	await waitFor(
		page,
		`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Stop')`,
	);
	const activeEnergy = sampleMacEnergy(PROFILE);
	await clickButton(page, "Stop");
	await waitFor(
		page,
		`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Hum again')`,
	);
	const idleEnergy = sampleMacEnergy(PROFILE);
	check(
		"active and post-stop relative energy samples are available",
		activeEnergy.processCount > 0 &&
			idleEnergy.processCount > 0 &&
			Number.isFinite(activeEnergy.relativePower) &&
			Number.isFinite(idleEnergy.relativePower),
		`active POWER ${activeEnergy.relativePower}; post-stop POWER ${idleEnergy.relativePower}`,
	);
	const performanceEvidence = {
		firstStopToRenderMs: firstStopMs,
		repeatStopToRenderMs: repeatStopMs,
		jsHeapUsedBytes: heap,
		domNodes: metricMap.Nodes ?? null,
		taskDurationSeconds: metricMap.TaskDuration ?? null,
		scriptDurationSeconds: metricMap.ScriptDuration ?? null,
		layoutDurationSeconds: metricMap.LayoutDuration ?? null,
		sustainedTakeCount: SUSTAINED_TAKES,
		sustainedStopToRenderP50Ms: latencyP50,
		sustainedStopToRenderP95Ms: latencyP95,
		sustainedHeapDeltaBytes: heapDelta,
		sustainedDomNodeSpread: domNodeSpread,
		sustainedCycles: sustained,
		projectOwnedWavVariants: wavVariants,
		chromeProcessCount: activeEnergy.processCount,
		macOsActiveRelativePower: activeEnergy.relativePower,
		macOsPostStopRelativePower: idleEnergy.relativePower,
		chromeActiveCpuPercentAtSample: activeEnergy.cpuPercent ?? null,
		chromePostStopCpuPercentAtSample: idleEnergy.cpuPercent ?? null,
		energyBoundary:
			"macOS top POWER is a relative sampled energy-impact signal, not watts or battery-life proof",
	};
	writeFileSync(
		resolve(OUTPUT, "performance.json"),
		`${JSON.stringify(performanceEvidence, null, 2)}\n`,
	);
	writeFileSync(
		resolve(OUTPUT, "top-energy-active-sample.txt"),
		activeEnergy.raw,
	);
	writeFileSync(
		resolve(OUTPUT, "top-energy-post-stop-sample.txt"),
		idleEnergy.raw,
	);
	console.log(JSON.stringify(performanceEvidence, null, 2));
	page.close();
} finally {
	for (const child of [chrome, server]) {
		if (!child) continue;
		child.kill("SIGTERM");
		if (child.exitCode === null) {
			await Promise.race([
				new Promise((resolveExit) => child.once("exit", resolveExit)),
				delay(5000),
			]);
		}
	}
	rmSync(PROFILE, { recursive: true, force: true });
}
