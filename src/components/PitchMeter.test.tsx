import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PitchMeter } from "./PitchMeter";

describe("PitchMeter", () => {
	it("does not claim to be listening before capture starts", () => {
		render(<PitchMeter pitch={null} />);
		expect(screen.getByLabelText("Ready to listen")).toBeTruthy();
		expect(screen.getByText("ready when you are")).toBeTruthy();
		expect(screen.queryByText("listening…")).toBeNull();
	});

	it("announces an unpitched frame while capture is active", () => {
		render(<PitchMeter pitch={null} isListening />);
		expect(screen.getByLabelText("Listening; no pitch detected")).toBeTruthy();
		expect(screen.getByText("listening…")).toBeTruthy();
	});
});
