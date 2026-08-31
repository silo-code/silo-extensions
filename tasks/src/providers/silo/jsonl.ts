/**
 * Pure newline-delimited-JSON parse / serialize for the Silo provider's
 * `tasks.jsonl`. No I/O — {@link import("./file-store").createFileStore} owns
 * the filesystem.
 *
 * The **`unparsed` channel** is the load-bearing part of R1: a hand-edited typo
 * on line 7 must not cost the user lines 1–6 or line 8, and must not be quietly
 * erased on the next write. A line that is not valid JSON, is not an object, or
 * carries a schema `v` this code doesn't understand is kept verbatim with its
 * original line index and re-emitted by {@link serializeJsonl}.
 */

import type { SiloTaskRecord } from "./record";
import { isKnownRecordShape } from "./record";

export interface UnparsedLine {
  /** The line's index in the file as loaded (0-based). */
  readonly index: number;
  /** The raw text, exactly as it appeared. */
  readonly line: string;
}

export interface ParsedFile {
  readonly records: readonly SiloTaskRecord[];
  readonly unparsed: readonly UnparsedLine[];
}

export const EMPTY_PARSED: ParsedFile = { records: [], unparsed: [] };

/**
 * Parse a `tasks.jsonl` body. Blank lines (including a trailing newline) are
 * dropped and not treated as unparsed. Every other line is either a valid
 * record or an {@link UnparsedLine}.
 */
export function parseJsonl(text: string): ParsedFile {
  const records: SiloTaskRecord[] = [];
  const unparsed: UnparsedLine[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      unparsed.push({ index, line });
      return;
    }
    if (isKnownRecordShape(value)) {
      records.push(value);
    } else {
      unparsed.push({ index, line });
    }
  });
  return { records, unparsed };
}

/**
 * Serialize back to a `tasks.jsonl` body with a trailing newline. Unparsed
 * lines are placed back at their recorded index where possible (so a pure
 * round trip is byte-stable for the corrupt line); records fill the remaining
 * slots in order. After mutations the index is best-effort — the guarantee is
 * that no unparsed line is dropped.
 */
export function serializeJsonl(file: ParsedFile): string {
  const total = file.records.length + file.unparsed.length;
  if (total === 0) return "";
  const slots: (string | null)[] = new Array(total).fill(null);

  for (const u of file.unparsed) {
    let at = Math.min(Math.max(u.index, 0), total - 1);
    while (slots[at] !== null) at = (at + 1) % total;
    slots[at] = u.line;
  }

  let r = 0;
  for (let i = 0; i < total; i++) {
    if (slots[i] === null) {
      slots[i] = JSON.stringify(file.records[r++]);
    }
  }

  return slots.join("\n") + "\n";
}
