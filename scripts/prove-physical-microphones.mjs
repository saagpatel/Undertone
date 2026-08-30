#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.UNDERTONE_MIC_PROOF_PORT ?? 5175);
const DEBUG_PORT = Number(process.env.UNDERTONE_MIC_DEBUG_PORT ?? 9335);
const ORIGIN = `http://localhost:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VITE = resolve(ROOT, "node_modules/vite/bin/vite.js");
const AUDIO = resolve(ROOT, "tests/fixtures/rehearsal-hum.wav");
const OUTPUT = resolve(ROOT, "artifacts/physical-mic-proof");
const PROFILE = mkdtempSync(join(tmpdir(), "undertone-physical-mic-"));
const requestedLabels = (
	process.env.UNDERTONE_PHYSICAL_MIC_LABELS ??
	"MacBook Pro Microphone,USB Microphone,BlackHole 2ch"
)
	.split(",")
	.map((label) => label.trim())
	.filter(Boolean);

const delay = (ms) =>
	new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForChild(child, timeoutMs = 8_000) {
	if (child.exitCode !== null) return child.exitCode;
	return await Promise.race([
		new Promise((resolveExit) => child.once("exit", resolveExit)),
		delay(timeoutMs).then(() => null),
	]);
}

async function waitForHttp(url, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Local server or Chrome is still starting.
		}
		await delay(100);
	}
	throw new Error(`Timed out waiting for ${url}`);
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

async function newPage() {
	const target = await fetch(
		`http://127.0.0.1:${DEBUG_PORT}/json/new?about%3Ablank`,
		{ method: "PUT" },
	).then((response) => response.json());
	const page = new Cdp(target.webSocketDebuggerUrl);
	await page.ready;
	await Promise.all([
		page.send("Page.enable"),
		page.send("Runtime.enable"),
		page.send("Network.enable"),
		page.send("Log.enable"),
	]);
	return page;
}

async function evaluate(page, expression) {
	const result = await page.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text ??
				"Runtime evaluation failed",
		);
	}
	return result.result.value;
}

async function waitFor(page, expression, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await evaluate(page, expression)) return;
		await delay(80);
	}
	throw new Error(`Timed out waiting for ${expression}`);
}

async function navigate(page) {
	await page.send("Page.navigate", { url: ORIGIN });
	await waitFor(page, "document.readyState === 'complete'");
	await waitFor(
		page,
		"document.querySelector('h1')?.textContent === 'Undertone'",
	);
}

async function click(page, label) {
	const clicked = await evaluate(
		page,
		`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true; })()`,
	);
	if (!clicked) throw new Error(`Button not found: ${label}`);
}

function routeInjection(label) {
	return `
(() => {
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const target = devices.find((device) => device.kind === 'audioinput' && device.label.includes(${JSON.stringify(label)}));
    if (!target) throw new DOMException('Requested validation route unavailable', 'NotFoundError');
    const requestedAudio = typeof constraints?.audio === 'object' ? constraints.audio : {};
    const stream = await nativeGetUserMedia({
      ...constraints,
      audio: { ...requestedAudio, deviceId: { exact: target.deviceId } },
    });
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings?.() ?? {};
    window.__undertonePhysicalTrack = track;
    window.__undertoneRouteReadback = {
      label: track?.label ?? '',
      sampleRate: settings.sampleRate ?? null,
      channelCount: settings.channelCount ?? null,
      echoCancellation: settings.echoCancellation ?? null,
      noiseSuppression: settings.noiseSuppression ?? null,
      autoGainControl: settings.autoGainControl ?? null,
    };
    return stream;
  };
})();
`;
}

function routeCategory(label) {
	if (label.includes("MacBook Pro Microphone")) return "built-in";
	if (label.includes("USB Microphone")) return "usb";
	if (label.includes("BlackHole")) return "virtual-control";
	if (label.includes("Phone Microphone")) return "continuity";
	return "other-audio-input";
}

let server = null;
let chrome = null;
const evidence = {
	schema: "UndertonePhysicalMicrophoneEvidenceV1",
	origin: ORIGIN,
	requestedRouteCategories: requestedLabels.map(routeCategory),
	audioRetention: "none; no samples or recordings were serialized",
	claimBoundary:
		"Route identity is MediaStreamTrack readback in this local Chrome session; this is not hardware-latency, human-humming, production, or learning evidence.",
	routes: [],
};

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
			"--autoplay-policy=no-user-gesture-required",
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	await waitForHttp(ORIGIN);
	await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);

	const primer = await newPage();
	await navigate(primer);
	const defaultRoute = await evaluate(
		primer,
		`(async () => { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const track = stream.getAudioTracks()[0]; const settings = track?.getSettings?.() ?? {}; const result = { label: track?.label ?? '', sampleRate: settings.sampleRate ?? null, channelCount: settings.channelCount ?? null }; stream.getTracks().forEach((item) => item.stop()); return result; })()`,
	);
	const availableLabels = await evaluate(
		primer,
		`(async () => (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput').map((device) => device.label))()`,
	);
	evidence.defaultRoute = {
		category: routeCategory(defaultRoute.label),
		sampleRate: defaultRoute.sampleRate,
		channelCount: defaultRoute.channelCount,
	};
	evidence.availableRouteCategories = [
		...new Set(availableLabels.map(routeCategory)),
	];
	primer.close();

	for (const label of requestedLabels) {
		const route = {
			category: routeCategory(label),
			kind: label === "BlackHole 2ch" ? "virtual-control" : "physical",
			available: availableLabels.some((available) => available.includes(label)),
		};
		if (!route.available) {
			route.status = "unavailable";
			evidence.routes.push(route);
			continue;
		}

		const scenarios =
			route.kind === "physical"
				? [
						{ name: "ambient", playbackVolume: null },
						{ name: "quiet-project-owned-stimulus", playbackVolume: 0.18 },
						{ name: "normal-project-owned-stimulus", playbackVolume: 0.55 },
					]
				: [{ name: "ambient-control", playbackVolume: null }];
		route.scenarios = [];
		for (const scenario of scenarios) {
			const page = await newPage();
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
			await page.send("Page.addScriptToEvaluateOnNewDocument", {
				source: routeInjection(label),
			});
			const result = { ...scenario };
			try {
				await navigate(page);
				await click(page, "Start humming");
				await waitFor(
					page,
					`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Stop')`,
				);
				if (scenario.playbackVolume === null) {
					await delay(1_600);
				} else {
					await delay(150);
					const playback = spawn(
						"/usr/bin/afplay",
						["-v", String(scenario.playbackVolume), AUDIO],
						{ stdio: "ignore" },
					);
					const playbackExit = await waitForChild(playback);
					if (playbackExit === null) {
						playback.kill("SIGTERM");
						throw new Error("Project-owned acoustic stimulus timed out");
					}
					result.playbackExit = playbackExit;
				}
				await click(page, "Stop");
				await waitFor(
					page,
					`[...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Hum again')`,
				);
				result.status = "captured";
				const rawReadback = await evaluate(
					page,
					"window.__undertoneRouteReadback",
				);
				result.routeMatched = rawReadback.label.includes(label);
				result.readback = {
					category: routeCategory(rawReadback.label),
					sampleRate: rawReadback.sampleRate,
					channelCount: rawReadback.channelCount,
					echoCancellation: rawReadback.echoCancellation,
					noiseSuppression: rawReadback.noiseSuppression,
					autoGainControl: rawReadback.autoGainControl,
				};
				result.trackStateAfterStop = await evaluate(
					page,
					"window.__undertonePhysicalTrack?.readyState ?? null",
				);
				result.quality = await evaluate(
					page,
					"document.querySelector('.rehearsal-quality')?.innerText ?? null",
				);
				result.alert = await evaluate(
					page,
					"document.querySelector('[role=alert]')?.textContent ?? null",
				);
				result.noteCount = await evaluate(
					page,
					"document.querySelectorAll('.notation ellipse[data-note-index]').length",
				);
				result.offOriginRequests = requests.filter(
					(url) => !url.startsWith(ORIGIN),
				);
				result.browserErrors = errors;
			} catch (error) {
				result.status = "failed";
				result.error = error instanceof Error ? error.message : String(error);
			}
			page.close();
			route.scenarios.push(result);
		}
		route.status = route.scenarios.every(
			(scenario) => scenario.status === "captured",
		)
			? "captured"
			: "failed";
		route.signalOutcome = route.scenarios.some(
			(scenario) => scenario.playbackVolume !== null && scenario.noteCount >= 3,
		)
			? "project-owned-acoustic-phrase-detected"
			: "no-note-evidence";
		evidence.routes.push(route);
	}

	const physicalRoutes = evidence.routes.filter(
		(route) => route.kind === "physical" && route.available,
	);
	if (physicalRoutes.length === 0) {
		throw new Error("No requested physical microphone route was available");
	}
	for (const route of physicalRoutes) {
		if (
			route.status !== "captured" ||
			!route.scenarios.every(
				(scenario) =>
					scenario.routeMatched === true &&
					scenario.trackStateAfterStop === "ended" &&
					scenario.offOriginRequests?.length === 0 &&
					scenario.browserErrors?.length === 0,
			)
		) {
			throw new Error(`Physical route did not pass: ${route.category}`);
		}
	}
	const acousticDetections = physicalRoutes.flatMap((route) =>
		route.scenarios.filter(
			(scenario) => scenario.playbackVolume !== null && scenario.noteCount >= 3,
		),
	);
	if (acousticDetections.length === 0) {
		throw new Error(
			"No physical route detected the project-owned acoustic phrase",
		);
	}
	evidence.decision = "PASS_ROUTE_LIFECYCLE_WITH_PARTIAL_SIGNAL_COVERAGE";
	writeFileSync(
		resolve(OUTPUT, "physical-microphones.json"),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
	evidence.decision = "INCOMPLETE";
	evidence.error = error instanceof Error ? error.message : String(error);
	mkdirSync(OUTPUT, { recursive: true });
	writeFileSync(
		resolve(OUTPUT, "physical-microphones.json"),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	throw error;
} finally {
	for (const child of [chrome, server]) {
		if (!child) continue;
		child.kill("SIGTERM");
		if (child.exitCode === null) {
			await Promise.race([
				new Promise((resolveExit) => child.once("exit", resolveExit)),
				delay(5_000),
			]);
		}
	}
	rmSync(PROFILE, { recursive: true, force: true });
}
