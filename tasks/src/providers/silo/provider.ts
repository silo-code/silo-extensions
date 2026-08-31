/**
 * `SiloTaskProvider` — the {@link TaskProvider} implementation for
 * Silo-managed sources. Every method routes through a per-source
 * {@link FileStore}; the provider itself holds no task state.
 */

import type { FileService } from "@silo-code/sdk";
import type { DetailSection } from "../../model/detail";
import type {
  Task,
  TaskDraft,
  TaskLane,
  TaskPatch,
} from "../../model/task";
import type { TaskProvider, TaskSource } from "../../model/source";
import { generateTaskId, nextRank } from "../../lib/ids";
import type { UnparsedLine } from "./jsonl";
import { createFileStore, type FileStore, type FileStoreOptions } from "./file-store";
import {
  applyPatch,
  newRecord,
  toDetailSections,
  toTask,
  type SiloTaskRecord,
} from "./record";

/** Reported after every `list()` — an empty array means the file is clean. */
export type DiagnosticsHandler = (
  source: TaskSource,
  unparsed: readonly UnparsedLine[],
) => void;

export class SiloTaskProvider implements TaskProvider {
  readonly id = "silo";
  readonly displayName = "Silo";

  /** One store per source path, created lazily and reused. */
  private readonly stores = new Map<string, FileStore>();

  constructor(
    private readonly files: FileService,
    private readonly storeOptions: FileStoreOptions = {},
    private readonly onDiagnostics?: DiagnosticsHandler,
  ) {}

  /** The store for a source — reused across calls so its watch and queue persist. */
  storeFor(source: TaskSource): FileStore {
    let store = this.stores.get(source.locator);
    if (!store) {
      const slash = Math.max(
        source.locator.lastIndexOf("/"),
        source.locator.lastIndexOf("\\"),
      );
      const dir = source.locator.slice(0, slash);
      const name = source.locator.slice(slash + 1);
      store = createFileStore(this.files, dir, name, this.storeOptions);
      this.stores.set(source.locator, store);
    }
    return store;
  }

  async list(source: TaskSource): Promise<readonly Task[]> {
    const parsed = await this.storeFor(source).load();
    this.onDiagnostics?.(source, parsed.unparsed);
    return parsed.records.map((r) => toTask(r, source.id));
  }

  async detail(
    source: TaskSource,
    taskId: string,
  ): Promise<readonly DetailSection[]> {
    const parsed = await this.storeFor(source).load();
    const record = parsed.records.find((r) => r.id === taskId);
    if (!record) {
      throw new Error(`No task ${taskId} in ${source.name}`);
    }
    return toDetailSections(record);
  }

  async createTask(source: TaskSource, draft: TaskDraft): Promise<Task> {
    const id = generateTaskId();
    let created: SiloTaskRecord | undefined;
    await this.storeFor(source).mutate((records) => {
      const record = newRecord({
        id,
        title: draft.title,
        rank: nextRank(records.map((r) => r.rank)),
        lane: draft.lane,
        priority: draft.priority,
        labels: draft.labels,
        providerFields: draft.providerFields,
      });
      records.push(record);
      created = record;
    });
    // `created` is set by the last successful `fn` run.
    return toTask(created as SiloTaskRecord, source.id);
  }

  async updateTask(
    source: TaskSource,
    taskId: string,
    patch: TaskPatch,
  ): Promise<Task> {
    let updated: SiloTaskRecord | undefined;
    await this.storeFor(source).mutate((records) => {
      const i = records.findIndex((r) => r.id === taskId);
      if (i < 0) throw new Error(`No task ${taskId} in ${source.name}`);
      records[i] = applyPatch(records[i], patch);
      updated = records[i];
    });
    return toTask(updated as SiloTaskRecord, source.id);
  }

  async setLane(
    source: TaskSource,
    taskId: string,
    lane: TaskLane,
  ): Promise<Task> {
    return this.updateTask(source, taskId, { lane });
  }

  async deleteTask(source: TaskSource, taskId: string): Promise<void> {
    await this.storeFor(source).mutate((records) => {
      const i = records.findIndex((r) => r.id === taskId);
      if (i >= 0) records.splice(i, 1);
    });
  }

  watch(source: TaskSource, onChange: () => void): { dispose(): void } {
    return this.storeFor(source).watch(onChange);
  }
}
