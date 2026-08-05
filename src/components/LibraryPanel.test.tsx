import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleComposition } from "../storage/storeContract";
import type { CompositionRecord } from "../storage/types";
import { LibraryPanel } from "./LibraryPanel";

function record(partial: Partial<CompositionRecord> = {}): CompositionRecord {
	return {
		id: "id-1",
		name: "Morning hum",
		createdAt: 1_754_000_000_000,
		updatedAt: 1_754_000_000_000,
		composition: sampleComposition(),
		...partial,
	};
}

function renderPanel(overrides: Partial<Parameters<typeof LibraryPanel>[0]> = {}) {
	const props = {
		records: [] as CompositionRecord[],
		kind: "indexeddb" as const,
		error: null,
		canSave: true,
		openRecord: null,
		hasUnsavedEdits: false,
		onSave: vi.fn(),
		onSaveOver: vi.fn(),
		onOpen: vi.fn(),
		onRename: vi.fn(),
		onDelete: vi.fn(),
		onExport: vi.fn(),
		onImport: vi.fn(),
		...overrides,
	};
	render(<LibraryPanel {...props} />);
	return props;
}

describe("LibraryPanel: saving", () => {
	it("invites you to hum something when the library is empty", () => {
		renderPanel();
		expect(screen.getByText(/nothing saved yet/i)).toBeTruthy();
	});

	it("saves under a typed name and clears the field", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		await user.type(screen.getByLabelText(/save this score as/i), "Take one");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(props.onSave).toHaveBeenCalledWith("Take one");
		expect(
			(screen.getByLabelText(/save this score as/i) as HTMLInputElement).value,
		).toBe("");
	});

	it("will not save an empty name", async () => {
		const props = renderPanel();
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(props.onSave).not.toHaveBeenCalled();
	});

	it("disables saving when there is no score on screen", () => {
		renderPanel({ canSave: false });
		expect(
			(screen.getByLabelText(/save this score as/i) as HTMLInputElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: /export file/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});

describe("LibraryPanel: deleting", () => {
	it("asks before deleting rather than deleting on the first click", async () => {
		const user = userEvent.setup();
		const props = renderPanel({ records: [record()] });

		await user.click(screen.getByRole("button", { name: "Delete" }));

		expect(props.onDelete).not.toHaveBeenCalled();
		expect(screen.getByText(/delete "morning hum" for good\?/i)).toBeTruthy();
	});

	it("deletes once confirmed", async () => {
		const user = userEvent.setup();
		const props = renderPanel({ records: [record()] });

		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.click(screen.getByRole("button", { name: /delete for good/i }));

		expect(props.onDelete).toHaveBeenCalledWith("id-1");
	});

	it("keeps the composition when the confirmation is dismissed", async () => {
		const user = userEvent.setup();
		const props = renderPanel({ records: [record()] });

		await user.click(screen.getByRole("button", { name: "Delete" }));
		await user.click(screen.getByRole("button", { name: /keep it/i }));

		expect(props.onDelete).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: /morning hum/i })).toBeTruthy();
	});

	it("confirms for the record you asked about, not another", async () => {
		const user = userEvent.setup();
		renderPanel({
			records: [record(), record({ id: "id-2", name: "Evening hum" })],
		});

		await user.click(screen.getAllByRole("button", { name: "Delete" })[1]);

		expect(screen.getByText(/delete "evening hum" for good\?/i)).toBeTruthy();
		expect(screen.queryByText(/delete "morning hum"/i)).toBeNull();
	});
});

describe("LibraryPanel: opening and renaming", () => {
	it("opens a saved composition", async () => {
		const user = userEvent.setup();
		const props = renderPanel({ records: [record()] });

		await user.click(screen.getByRole("button", { name: /morning hum/i }));

		expect(props.onOpen).toHaveBeenCalledWith("id-1");
	});

	it("shows the note count so a record is identifiable at a glance", () => {
		renderPanel({ records: [record()] });
		expect(screen.getByText(/2 notes/)).toBeTruthy();
	});

	it("renames through an inline field seeded with the current name", async () => {
		const user = userEvent.setup();
		const props = renderPanel({ records: [record()] });

		await user.click(screen.getByRole("button", { name: "Rename" }));
		const field = screen.getByLabelText(/new name for morning hum/i);
		expect((field as HTMLInputElement).value).toBe("Morning hum");

		await user.clear(field);
		await user.type(field, "Evening hum");
		await user.click(screen.getByRole("button", { name: "Rename" }));

		expect(props.onRename).toHaveBeenCalledWith("id-1", "Evening hum");
	});

	it("cancels a rename without changing anything", async () => {
		const user = userEvent.setup();
		const props = renderPanel({ records: [record()] });

		await user.click(screen.getByRole("button", { name: "Rename" }));
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(props.onRename).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: /morning hum/i })).toBeTruthy();
	});
});

describe("LibraryPanel: saving over an open record", () => {
	it("says nothing about an open record when none is open", () => {
		renderPanel({ records: [record()] });
		expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
	});

	it("names the open record and disables saving until it is edited", () => {
		renderPanel({
			records: [record()],
			openRecord: { id: "id-1", name: "Morning hum" },
			hasUnsavedEdits: false,
		});

		expect(screen.getByText(/showing "morning hum"/i)).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: /save changes/i,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("offers to save over once the score has been edited", async () => {
		const user = userEvent.setup();
		const props = renderPanel({
			records: [record()],
			openRecord: { id: "id-1", name: "Morning hum" },
			hasUnsavedEdits: true,
		});

		expect(screen.getByText(/edited since you opened/i)).toBeTruthy();
		await user.click(screen.getByRole("button", { name: /save changes/i }));

		expect(props.onSaveOver).toHaveBeenCalledWith("id-1");
	});
});

describe("LibraryPanel: storage state", () => {
	it("says plainly when storage will not survive the tab", () => {
		renderPanel({ kind: "memory" });
		expect(screen.getByRole("status").textContent).toMatch(
			/last until you close the tab/i,
		);
	});

	it("says nothing about storage when it is durable", () => {
		renderPanel({ kind: "indexeddb" });
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("surfaces a library error as an alert", () => {
		renderPanel({ error: "Your browser's storage is full." });
		expect(screen.getByRole("alert").textContent).toMatch(/storage is full/i);
	});
});

describe("LibraryPanel: file import", () => {
	it("hands an imported file to the caller", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		const file = new File(["{}"], "score.json", { type: "application/json" });
		await user.upload(
			document.getElementById("library-import") as HTMLInputElement,
			file,
		);

		expect(props.onImport).toHaveBeenCalledWith(file);
	});

	it("exports on request", async () => {
		const user = userEvent.setup();
		const props = renderPanel();

		await user.click(screen.getByRole("button", { name: /export file/i }));

		expect(props.onExport).toHaveBeenCalled();
	});
});
