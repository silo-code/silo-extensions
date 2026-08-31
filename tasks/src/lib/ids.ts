/**
 * Task id and `rank` generation. Pure — no `ctx`, no React.
 *
 * `rank` is a zero-padded counter so it sorts **lexicographically** in
 * creation order. Phase 1 ships no drag-reordering, so there is deliberately no
 * insert-between (midpoint) generator — nothing could call it. The field is a
 * string precisely so phase 2's table can swap in a midpoint scheme without a
 * file migration.
 */

const RANK_WIDTH = 12;

let counter = 0;

/**
 * A task id: a short timestamp base plus a monotonic suffix, so a burst of
 * `createTask` calls in the same millisecond still produces distinct ids
 * without depending on a crypto RNG.
 */
export function generateTaskId(now: number = Date.now()): string {
  counter = (counter + 1) % 0x1000000;
  const time = now.toString(36);
  const seq = counter.toString(36).padStart(5, "0");
  const rand = Math.floor(Math.random() * 0x1000000)
    .toString(36)
    .padStart(5, "0");
  return `t_${time}_${seq}${rand}`;
}

/**
 * The next append-order rank given the ranks already in the file. Returns a
 * zero-padded decimal string one past the current maximum, so a fresh file
 * starts at `000000000001` and every later task sorts after every earlier one.
 *
 * Tolerates a file whose ranks aren't all numeric (a hand edit): non-numeric
 * ranks are ignored when computing the max.
 */
export function nextRank(existingRanks: readonly string[]): string {
  let max = 0;
  for (const r of existingRanks) {
    const n = Number(r);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(RANK_WIDTH, "0");
}
