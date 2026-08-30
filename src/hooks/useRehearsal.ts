import { useCallback, useEffect, useReducer } from "react";
import {
	compareTakes,
	type MelodyTake,
	type TakeComparison,
} from "../dsp/rehearsal";

export interface RehearsalSession {
	baseline: MelodyTake | null;
	repeat: MelodyTake | null;
	comparison: TakeComparison | null;
}

export type RehearsalAction =
	| { type: "set-baseline"; take: MelodyTake }
	| { type: "accept-repeat"; take: MelodyTake }
	| { type: "reset" };

export const EMPTY_REHEARSAL: RehearsalSession = {
	baseline: null,
	repeat: null,
	comparison: null,
};

/** Pure session reducer: state lives only for this mounted browser tab. */
export function rehearsalReducer(
	state: RehearsalSession,
	action: RehearsalAction,
): RehearsalSession {
	switch (action.type) {
		case "set-baseline":
			return { baseline: action.take, repeat: null, comparison: null };
		case "accept-repeat":
			if (
				!state.baseline ||
				action.take.id === state.baseline.id ||
				action.take.id === state.repeat?.id
			)
				return state;
			return {
				baseline: state.baseline,
				repeat: action.take,
				comparison: compareTakes(state.baseline, action.take),
			};
		case "reset":
			return EMPTY_REHEARSAL;
	}
}

export interface RehearsalController extends RehearsalSession {
	canStartFromCurrent: boolean;
	startFromCurrent: () => void;
	reset: () => void;
}

/**
 * Promotes one explicit completed microphone take to an immutable baseline,
 * then compares every later completed take to that same target.
 */
export function useRehearsal(
	latestTake: MelodyTake | null,
): RehearsalController {
	const [session, dispatch] = useReducer(rehearsalReducer, EMPTY_REHEARSAL);

	useEffect(() => {
		if (!latestTake || !session.baseline) return;
		dispatch({ type: "accept-repeat", take: latestTake });
	}, [latestTake, session.baseline]);

	const startFromCurrent = useCallback(() => {
		if (!latestTake) return;
		dispatch({ type: "set-baseline", take: latestTake });
	}, [latestTake]);

	const reset = useCallback(() => dispatch({ type: "reset" }), []);

	return {
		...session,
		canStartFromCurrent: latestTake !== null,
		startFromCurrent,
		reset,
	};
}
