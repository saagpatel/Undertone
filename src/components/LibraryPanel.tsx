import { useState } from "react";
import type { CompositionRecord, StoreKind } from "../storage/types";

interface LibraryPanelProps {
	records: CompositionRecord[];
	kind: StoreKind | null;
	error: string | null;
	/** True when there is a score on screen worth saving. */
	canSave: boolean;
	onSave: (name: string) => void;
	onOpen: (id: string) => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
	onExport: () => void;
	onImport: (file: File) => void;
}

function formatSaved(timestamp: number): string {
	return new Date(timestamp).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

/**
 * The composition library: save the current score under a name, reopen a past
 * one, rename, delete, and move compositions in and out as files.
 *
 * When the store fell back to memory the panel says so directly, because the
 * difference between "saved" and "saved until you close this tab" is exactly
 * what a user needs to know before trusting it.
 */
export function LibraryPanel({
	records,
	kind,
	error,
	canSave,
	onSave,
	onOpen,
	onRename,
	onDelete,
	onExport,
	onImport,
}: LibraryPanelProps) {
	const [draftName, setDraftName] = useState("");
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameDraft, setRenameDraft] = useState("");

	const submitSave = (event: React.FormEvent) => {
		event.preventDefault();
		const name = draftName.trim();
		if (!canSave || name.length === 0) return;
		onSave(name);
		setDraftName("");
	};

	const submitRename = (event: React.FormEvent, id: string) => {
		event.preventDefault();
		const name = renameDraft.trim();
		if (name.length === 0) return;
		onRename(id, name);
		setRenamingId(null);
	};

	return (
		<section className="library" aria-labelledby="library-heading">
			<div className="library__head">
				<h2 className="library__title" id="library-heading">
					Library
				</h2>
				{kind === "memory" && (
					<p className="library__notice" role="status">
						Browser storage is unavailable — these compositions last until you
						close the tab. Export a file to keep them.
					</p>
				)}
			</div>

			<form className="library__save" onSubmit={submitSave}>
				<label className="library__label" htmlFor="library-name">
					Save this score as
				</label>
				<div className="library__save-row">
					<input
						className="library__input"
						id="library-name"
						name="composition-name"
						placeholder="Morning hum"
						value={draftName}
						disabled={!canSave}
						onChange={(event) => setDraftName(event.target.value)}
					/>
					<button
						className="ghost-button"
						type="submit"
						disabled={!canSave || draftName.trim().length === 0}
					>
						Save
					</button>
				</div>
			</form>

			<div className="library__files">
				<button
					className="ghost-button"
					type="button"
					onClick={onExport}
					disabled={!canSave}
				>
					Export file
				</button>
				<label className="ghost-button library__import" htmlFor="library-import">
					Import file
					<input
						className="library__import-input"
						id="library-import"
						type="file"
						accept="application/json,.json"
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) onImport(file);
							// Reset so re-importing the same file fires a change event.
							event.target.value = "";
						}}
					/>
				</label>
			</div>

			{error && (
				<p className="library__error" role="alert">
					{error}
				</p>
			)}

			{records.length === 0 ? (
				<p className="library__empty">
					Nothing saved yet. Hum something, name it, and it will wait here for
					you.
				</p>
			) : (
				<ul className="library__list">
					{records.map((record) => (
						<li className="library__item" key={record.id}>
							{renamingId === record.id ? (
								<form
									className="library__rename"
									onSubmit={(event) => submitRename(event, record.id)}
								>
									<input
										className="library__input"
										aria-label={`New name for ${record.name}`}
										value={renameDraft}
										// biome-ignore lint/a11y/noAutofocus: the rename field replaces a button the user just pressed.
										autoFocus
										onChange={(event) => setRenameDraft(event.target.value)}
									/>
									<button className="ghost-button" type="submit">
										Rename
									</button>
									<button
										className="ghost-button"
										type="button"
										onClick={() => setRenamingId(null)}
									>
										Cancel
									</button>
								</form>
							) : (
								<>
									<button
										className="library__open"
										type="button"
										onClick={() => onOpen(record.id)}
									>
										<span className="library__name">{record.name}</span>
										<span className="library__meta">
											{record.composition.phrase.notes.length} notes ·{" "}
											{formatSaved(record.updatedAt)}
										</span>
									</button>
									<div className="library__item-actions">
										<button
											className="ghost-button"
											type="button"
											onClick={() => {
												setRenamingId(record.id);
												setRenameDraft(record.name);
											}}
										>
											Rename
										</button>
										<button
											className="ghost-button"
											type="button"
											onClick={() => onDelete(record.id)}
										>
											Delete
										</button>
									</div>
								</>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
