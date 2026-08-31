/**
 * One source's `tasks.jsonl` — load, atomic write, compare-and-swap mutation,
 * and an external-change watch. The **only** module in the extension that
 * touches the filesystem; everything above it fakes `FileService`.
 *
 * Two writers are in play: this extension (serialized by the per-store queue
 * below) and *anything else* — a hand edit, an agent appending a line. CAS
 * reconciles the second kind: a whole-file rewrite would otherwise silently
 * swallow an append that landed between the load and the rename. It is not
 * airtight — a write inside the final stat→rename gap is still lost — and that
 * residual is documented in the README, not papered over.
 */

import type { FileMeta, FileService } from "@silo-code/sdk";
import { path } from "@silo-code/sdk";
import {
  EMPTY_PARSED,
  parseJsonl,
  serializeJsonl,
  type ParsedFile,
} from "./jsonl";
import type { SiloTaskRecord } from "./record";

export interface FileStore {
  /** Load + parse the file. An absent file reads as an empty list, not an error. */
  load(): Promise<ParsedFile>;
  /**
   * Mutate the records in place. Re-applied against a fresh load if the file
   * changed underneath (CAS). Rejects — leaving the file untouched — if the
   * retry bound is exhausted. Serialized against other `mutate` calls on this
   * store.
   */
  mutate(
    fn: (records: SiloTaskRecord[]) => void,
  ): Promise<ParsedFile>;
  /**
   * Watch the source **directory** (not the file — the atomic rename replaces
   * the inode). Fires `onExternalChange` for a `tasks.jsonl` change this store
   * did not make. Debounced; self-writes suppressed by comparing bytes.
   */
  watch(onExternalChange: () => void): { dispose(): void };
}

export interface FileStoreOptions {
  /** Debounce for the external-change watch. Tests pass `0`. */
  debounceMs?: number;
  /** CAS retry bound. */
  maxRetries?: number;
}

function metaChanged(a: FileMeta | null, b: FileMeta | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return a.size !== b.size || a.modifiedMs !== b.modifiedMs;
}

/** Deep-enough clone for a record: the mutable fields are arrays of primitives / flat objects. */
function cloneRecord(r: SiloTaskRecord): SiloTaskRecord {
  return {
    ...r,
    labels: r.labels ? [...r.labels] : undefined,
    assignees: r.assignees ? [...r.assignees] : undefined,
    acceptanceCriteria: r.acceptanceCriteria
      ? r.acceptanceCriteria.map((i) => ({ ...i }))
      : undefined,
  };
}

export function createFileStore(
  files: FileService,
  dir: string,
  name: string,
  options: FileStoreOptions = {},
): FileStore {
  const debounceMs = options.debounceMs ?? 150;
  const maxRetries = options.maxRetries ?? 5;
  const filePath = path.join(dir, name);
  const tmpPath = path.join(dir, `.${name}.tmp`);

  let loadedMeta: FileMeta | null = null;
  let lastWrittenBytes: string | null = null;
  // The tail of the serialized mutation chain.
  let queue: Promise<unknown> = Promise.resolve();

  async function readParsed(): Promise<ParsedFile> {
    const meta = await files.stat(filePath);
    if (!meta) {
      loadedMeta = null;
      return EMPTY_PARSED;
    }
    const text = await files.readText(filePath);
    loadedMeta = meta;
    return parseJsonl(text);
  }

  async function runMutation(
    fn: (records: SiloTaskRecord[]) => void,
  ): Promise<ParsedFile> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const parsed = await readParsed();
      const records = parsed.records.map(cloneRecord);
      fn(records);
      const next: ParsedFile = { records, unparsed: parsed.unparsed };
      const body = serializeJsonl(next);

      await files.writeText(tmpPath, body);

      // CAS: has anything touched tasks.jsonl since we loaded it?
      const current = await files.stat(filePath);
      if (metaChanged(current, loadedMeta)) {
        lastError = new Error("file changed under write");
        continue;
      }

      // Set the self-write marker *before* the rename: the fake (and a real
      // watcher) can deliver the change event synchronously from inside
      // `rename`, and the marker must already hold `body` for the
      // content-based suppression to catch it.
      const previousMarker = lastWrittenBytes;
      lastWrittenBytes = body;
      try {
        await files.rename(tmpPath, filePath);
      } catch (err) {
        lastWrittenBytes = previousMarker;
        throw err;
      }
      loadedMeta = await files.stat(filePath);
      return next;
    }
    throw new Error(
      `tasks.jsonl at ${filePath} kept changing under a write after ${
        maxRetries + 1
      } attempts; the file was left untouched. Original error: ${String(
        lastError,
      )}`,
    );
  }

  return {
    load: () => {
      const p = queue.then(readParsed, readParsed);
      queue = p.catch(() => undefined);
      return p;
    },

    mutate: (fn) => {
      const p = queue.then(
        () => runMutation(fn),
        () => runMutation(fn),
      );
      queue = p.catch(() => undefined);
      return p;
    },

    watch: (onExternalChange) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;

      const fire = () => {
        void (async () => {
          try {
            const meta = await files.stat(filePath);
            if (!meta) {
              if (loadedMeta !== null || lastWrittenBytes !== null) {
                loadedMeta = null;
                lastWrittenBytes = null;
                if (!disposed) onExternalChange();
              }
              return;
            }
            const text = await files.readText(filePath);
            // Content-based self-write suppression — deterministic, not a
            // timing window. If the bytes on disk are exactly what we last
            // wrote, this event is our own rename echoing back.
            if (text === lastWrittenBytes) return;
            if (!disposed) onExternalChange();
          } catch {
            if (!disposed) onExternalChange();
          }
        })();
      };

      const sub = files.watch(dir, (event) => {
        const hit = event.paths.some((p) => path.basename(p) === name);
        if (!hit) return;
        if (timer) clearTimeout(timer);
        if (debounceMs <= 0) {
          fire();
        } else {
          timer = setTimeout(fire, debounceMs);
        }
      });

      return {
        dispose: () => {
          disposed = true;
          if (timer) clearTimeout(timer);
          sub.dispose();
        },
      };
    },
  };
}
