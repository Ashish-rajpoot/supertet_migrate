/* ===========================================================
   data/advance.ts - should answering move to the next question?

   Pure on purpose. The rule has enough guards that it is worth
   stating once, in one place, rather than inline in the component -
   and a mistake here is expensive: a student could lose a paper to
   a stray tap on the last question.

   Pure functions only - no DOM, no React.
   =========================================================== */

export interface AdvanceInput {
  /** The "move on as soon as I answer" toggle. */
  autoNext: boolean;
  /** Practice mode shows the explanation and locks the options. */
  mode: "test" | "practice";
  /** Nothing should move while the timer is held. */
  paused: boolean;
  /** 0-based index of the question just tapped. */
  idx: number;
  /** How many questions the run has. */
  total: number;
  /** Tapping the already-selected option clears the answer. */
  wasSame: boolean;
}

/**
 * True when picking an option should also move to the next question.
 *
 * Every guard is deliberate:
 *   - toggle off ......... the student asked to move manually
 *   - wasSame ............ that was a de-select, not an answer
 *   - practice ........... the explanation still has to be read
 *   - paused ............. the run is held
 *   - last question ...... advancing would submit the paper; the
 *                         student presses Finish on purpose instead
 */
export function shouldAutoAdvance(i: AdvanceInput): boolean {
  if (!i.autoNext) return false;
  if (i.wasSame) return false;
  if (i.mode !== "test") return false;
  if (i.paused) return false;
  return i.idx + 1 < i.total;
}