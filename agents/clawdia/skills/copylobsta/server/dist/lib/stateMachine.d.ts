import type { Session, SessionState } from "../types.js";
/** Check if a transition from → to is valid. */
export declare function canTransition(from: SessionState, to: SessionState): boolean;
/** Get the default next state in the happy path. */
export declare function getNextState(current: SessionState): SessionState | null;
/** Transition a session to a new state. Validates the transition and persists. */
export declare function transition(session: Session, targetState: SessionState): Session;
/** Get the step number (1-indexed) for display. */
export declare function getStepNumber(state: SessionState): number;
/** Total steps in the happy path. */
export declare const TOTAL_STEPS: number;
//# sourceMappingURL=stateMachine.d.ts.map