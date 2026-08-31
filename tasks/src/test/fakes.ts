/**
 * Shared test doubles — an in-memory `FileService` and a minimal
 * `ExtensionContext` fake (files, storage, workspaces, ui, log). No test
 * touches a real disk.
 */

import type {
  ExtensionContext,
  ExtensionStorage,
  FileChangeEvent,
  FileMeta,
  FileService,
  WorkspaceState,
} from "@silo-code/sdk";

export interface FakeFile {
  content: string;
  modifiedMs: number;
}

export interface FakeFileService extends FileService {
  /** Directly seed a file (bypasses watch events). */
  seed(path: string, content: string, modifiedMs?: number): void;
  /** Current raw content, or undefined if absent. */
  peek(path: string): string | undefined;
  /** Count of watch listeners currently attached. */
  watcherCount(): number;
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i < 0 ? "" : p.slice(0, i);
}

export function createFakeFileService(): FakeFileService {
  const files = new Map<string, FakeFile>();
  let clock = 1_000;
  const tick = () => (clock += 10);

  interface Listener {
    dir: string;
    fn: (e: FileChangeEvent) => void;
  }
  const listeners = new Set<Listener>();

  function fire(path: string, kind: FileChangeEvent["kind"]) {
    const dir = dirname(path);
    for (const l of listeners) {
      if (dir === l.dir || dir.startsWith(l.dir + "/")) {
        l.fn({ paths: [path], kind });
      }
    }
  }

  function metaOf(path: string): FileMeta | null {
    const f = files.get(path);
    if (!f) return null;
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return {
      name: path.slice(slash + 1),
      path,
      isDir: false,
      size: f.content.length,
      modifiedMs: f.modifiedMs,
    };
  }

  const svc: FakeFileService = {
    seed(path, content, modifiedMs) {
      files.set(path, { content, modifiedMs: modifiedMs ?? tick() });
    },
    peek: (path) => files.get(path)?.content,
    watcherCount: () => listeners.size,

    async readText(path) {
      const f = files.get(path);
      if (!f) throw new Error(`ENOENT: ${path}`);
      return f.content;
    },
    async readBytes(path) {
      return new TextEncoder().encode(await svc.readText(path)).buffer;
    },
    async readDir() {
      return [];
    },
    async pathExists(path) {
      return files.has(path);
    },
    async stat(path) {
      return metaOf(path);
    },
    async writeText(path, content) {
      files.set(path, { content, modifiedMs: tick() });
      fire(path, "modify");
    },
    async writeBytes(path, data) {
      const text = new TextDecoder().decode(
        data instanceof Uint8Array ? data : new Uint8Array(data),
      );
      await svc.writeText(path, text);
    },
    async createDir() {},
    async copy() {},
    async rename(oldPath, newPath) {
      const f = files.get(oldPath);
      if (!f) throw new Error(`ENOENT: ${oldPath}`);
      files.delete(oldPath);
      files.set(newPath, { content: f.content, modifiedMs: tick() });
      fire(newPath, "modify");
    },
    async delete(path) {
      files.delete(path);
      fire(path, "remove");
    },
    async reveal() {},
    watch(path, listener) {
      const l: Listener = { dir: path, fn: listener };
      listeners.add(l);
      return { dispose: () => listeners.delete(l) };
    },
  };
  return svc;
}

export function createFakeStorage(): ExtensionStorage & {
  hydrate(): void;
} {
  const map = new Map<string, unknown>();
  const subs = new Set<() => void>();
  const notify = () => {
    for (const s of subs) s();
  };
  return {
    get<T>(key: string, fallback?: T): T | undefined {
      return map.has(key) ? (map.get(key) as T) : fallback;
    },
    set(key, value) {
      if (value === undefined) map.delete(key);
      else map.set(key, value);
      notify();
    },
    keys: () => [...map.keys()],
    subscribe(listener) {
      subs.add(listener);
      return { dispose: () => subs.delete(listener) };
    },
    hydrate: notify,
  };
}

export interface FakeWorkspaces {
  service: ExtensionContext["workspaces"];
  setActive(id: string | null): void;
  setAll(all: WorkspaceState["all"]): void;
}

export function createFakeWorkspaces(
  initial: Partial<WorkspaceState> = {},
): FakeWorkspaces {
  let state: WorkspaceState = {
    all: [],
    open: [],
    closed: [],
    activeId: null,
    hydrated: true,
    ...initial,
  };
  const subs = new Set<(s: WorkspaceState) => void>();
  const notify = () => {
    for (const s of subs) s(state);
  };
  const service = {
    getState: () => state,
    subscribe(listener: (s: WorkspaceState) => void) {
      subs.add(listener);
      return { dispose: () => subs.delete(listener) };
    },
  } as unknown as ExtensionContext["workspaces"];
  return {
    service,
    setActive(id) {
      state = { ...state, activeId: id };
      notify();
    },
    setAll(all) {
      state = { ...state, all, open: all };
      notify();
    },
  };
}

export interface FakeCtx {
  ctx: Pick<
    ExtensionContext,
    "files" | "storage" | "workspaces" | "ui" | "log"
  >;
  files: FakeFileService;
  storageGlobal: ReturnType<typeof createFakeStorage>;
  workspaces: FakeWorkspaces;
  notices: { level: string; message: string }[];
  logs: { level: string; message: string }[];
}

export function makeCtx(opts: {
  globalDir: string;
  workspaceDir?: string | (() => Promise<string>);
}): FakeCtx {
  const files = createFakeFileService();
  const storageGlobal = createFakeStorage();
  const storageWorkspace = createFakeStorage();
  const workspaces = createFakeWorkspaces();
  const notices: { level: string; message: string }[] = [];
  const logs: { level: string; message: string }[] = [];

  const workspaceDir =
    typeof opts.workspaceDir === "function"
      ? opts.workspaceDir
      : async () => {
          if (opts.workspaceDir == null) {
            const { NoWorkspaceError } = await import("@silo-code/sdk");
            throw new NoWorkspaceError();
          }
          return opts.workspaceDir as string;
        };

  const ctx = {
    files,
    storage: {
      global: storageGlobal,
      workspace: storageWorkspace,
      globalDir: async () => opts.globalDir,
      workspaceDir,
    },
    workspaces: workspaces.service,
    ui: {
      notify: (level: string, message: string) =>
        notices.push({ level, message }),
      confirm: async () => true,
    } as unknown as ExtensionContext["ui"],
    log: {
      debug: (m: string) => logs.push({ level: "debug", message: m }),
      info: (m: string) => logs.push({ level: "info", message: m }),
      warn: (m: string) => logs.push({ level: "warn", message: m }),
      error: (m: string) => logs.push({ level: "error", message: m }),
      show: () => {},
      clear: () => {},
    } as unknown as ExtensionContext["log"],
  } as Pick<
    ExtensionContext,
    "files" | "storage" | "workspaces" | "ui" | "log"
  >;

  return { ctx, files, storageGlobal, workspaces, notices, logs };
}
