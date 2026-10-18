/**
 * The follow-up line inside a Workspaces-panel row: a cluster of label dots
 * and the count.
 *
 * **No elapsed time.** The host's status rows can render a `startedAt`, and
 * the first cut of this line did — but "1d" next to a count that spans
 * several marks answers a question nobody asked, and it competed with the
 * dots for the eye. A follow-up's own age is on its Navigator row.
 *
 * **Why a section and not a status row.** `WorkspaceStatusRow` draws one
 * host-owned {@link Activity} glyph — the five follow-up colors aren't
 * expressible through it, so the rollup could only ever be a single amber dot
 * that said nothing about *which* labels were waiting. `registerSection`
 * mounts a real component in the same grid column, so the row can carry one
 * dot per label in use at no extra height.
 *
 * The markup deliberately mirrors the host's own `.ws-status-row` metrics
 * (baseline-aligned flex, 5px gap, `calc(1em - 1.5px)`, `text-hi` label on a
 * `text-lo` row) so this line is indistinguishable from the status rows other
 * extensions contribute above it.
 *
 * Sections have **no** `invalidateSection` — a section is a live component, so
 * this re-renders off the two stores it reads (`marks`, `settings`) plus the
 * workspace state that decides which tabs are still live.
 */

import { useServiceState } from "@silo-code/sdk";
import type { ExtensionContext } from "@silo-code/sdk";
import type { MarksStore } from "../lib/marks-store";
import type { SettingsStore } from "../lib/settings-store";
import { breakdownText, labelBreakdown } from "../lib/summary";
import { statusLabel, summarizeMarks } from "../lib/store";
import type { WorkspaceIndex } from "../lib/workspace-index";

export function WorkspaceSummaryRow({
  workspaceId,
  ctx,
  marks,
  settings,
  index,
}: {
  workspaceId: string;
  ctx: ExtensionContext;
  marks: MarksStore;
  settings: SettingsStore;
  /**
   * The live index, read through a getter: `index` is **reassigned** on every
   * workspace-state change, and the extension's own subscriber — registered
   * at activate, so ahead of this component's — rebuilds it before React is
   * told to re-render.
   */
  index: () => WorkspaceIndex;
}) {
  const ws = useServiceState(ctx.workspaces);
  const marksSnapshot = useServiceState(marks);
  const { labels } = useServiceState(settings);

  // Before hydration every workspace looks empty and every mark looks stale —
  // the same guard `pruneAll` uses, so this never flashes a wrong count.
  if (!ws.hydrated) return null;

  const live = index().liveIds(workspaceId);
  const { count, byLabel } = summarizeMarks(
    marksSnapshot.state,
    workspaceId,
    live.editors,
    live.terminals,
    live.panels,
  );
  // `null`, not an empty row: the SDK is explicit that a section returning
  // `null` produces no DOM node and so no gap in the workspace's row.
  if (count < 1) return null;

  const entries = labelBreakdown(labels, byLabel);
  const breakdown = breakdownText(entries);

  return (
    <div
      className="fu-ws-row"
      title={breakdown}
      aria-label={`${statusLabel(count)}: ${breakdown}`}
    >
      <span className="fu-ws-dots" aria-hidden="true">
        {entries.map((e) => (
          <span
            key={e.label.id}
            className={`fu-ws-dot fu-swatch-${e.label.id}`}
          />
        ))}
      </span>
      <span className="fu-ws-count">{statusLabel(count)}</span>
    </div>
  );
}
