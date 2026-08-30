# Rehearsal feedback comprehension pilot

This is a small, local usability protocol for Undertone's confidence-aware
rehearsal feedback. It tests whether the copy is understandable; it does not
measure singing ability, vocal health, pedagogy, or learning benefit.

## Evidence boundary

- Use exactly five consenting participants who are not coached on the UI.
- Run the app locally. Do not upload audio or enable analytics.
- Do not retain recordings, names, contact details, or free-form voice data.
- Record only scenario codes and categorical answers in a session-local note.
- Agent or automated DOM review is proxy evidence, never participant evidence.

## Scenarios

Present these in a different order for each participant:

1. Low-confidence pitched frames.
2. Energetic background noise.
3. Insufficient or silent audio.
4. A one-note count mismatch with hypothesis-only alignment.
5. A confident global transposition with small local variation.

For every scenario, ask without explaining the interface:

1. Is this result reliable enough to treat as a verdict?
2. What would you do next?
3. Is Undertone making a health, technique, or learning claim?
4. What is the difference between overall pitch shift and local pitch variation?

## Categorical scoring

- `reliability`: `correct`, `incorrect`, or `unclear`.
- `next_action`: `actionable`, `not_actionable`, or `unclear`.
- `claim_boundary`: `correct`, `incorrect`, or `unclear`.
- `pitch_model`: `correct`, `partial`, `incorrect`, or `unclear`.
- `confusion_code`: optional bounded code such as `jargon`, `metric_direction`,
  `confidence`, `next_action`, or `none`.

The pilot supports a local comprehension pass only when at least four of five
responses per scenario correctly identify reliability and an actionable next
step, every participant rejects health/technique/learning interpretations, and
at least four of five distinguish global shift from local variation. Smaller
samples or missed thresholds remain `UNKNOWN` or a finding; they are not
averaged into a pass.

## Results template

| Participant code | Scenario | Reliability | Next action | Claim boundary | Pitch model | Confusion code |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | low-confidence |  |  |  |  |  |

Delete the session-local response note after summarizing categorical counts if
the participant agreement does not authorize longer local retention.
