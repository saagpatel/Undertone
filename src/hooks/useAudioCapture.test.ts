import { describe, expect, it } from "vitest";
import { describeMicrophoneError } from "./useAudioCapture";

describe("describeMicrophoneError", () => {
	it("explains permission denial without diagnosing the user", () => {
		expect(
			describeMicrophoneError(new DOMException("denied", "NotAllowedError")),
		).toContain("permission was denied");
	});

	it("distinguishes a missing device from an unavailable route", () => {
		expect(
			describeMicrophoneError(new DOMException("missing", "NotFoundError")),
		).toContain("No microphone is available");
		expect(
			describeMicrophoneError(new DOMException("busy", "NotReadableError")),
		).toContain("unavailable or already in use");
	});

	it("uses a stable fallback for non-Error failures", () => {
		expect(describeMicrophoneError({ reason: "unknown" })).toContain(
			"Check the input route",
		);
	});
});
