/**
 * The Follow-ups settings page — rename / reorder the five labels and pick the
 * default.
 *
 * Two groups, because they answer two different questions: *what are my
 * labels* (the list) and *which one does the Flag button use* (one row, one
 * control). An earlier pass put a radio on every label row, which made the
 * list do both jobs at once — the radio column read as part of each label's
 * identity, and the one thing a user comes here to change was five identical
 * controls deep. A `Select` in a `SettingRow` is the kit's own answer for
 * "one of a short enumerable set", and it states the current default in words
 * instead of as a filled dot you have to scan for.
 *
 * Copy here is **instructions, not rationale** — written for someone using
 * the extension, not someone maintaining it. Every line says what to do and
 * what happens as a result; it names things the user can see (the Flag
 * button, its caret, the Follow-ups view) and never the machinery behind them
 * (theme tints, semantic color tokens, why the set can't grow). Earlier
 * passes leaked both: a paragraph on why there are exactly five labels, and a
 * default-label hint phrased as "what flagging applies," which describes the
 * code's job rather than telling anyone what to click. That reasoning belongs
 * in `lib/labels.ts`, and the full tour belongs in the README.
 *
 * There is no "show the Navigator view" switch here: the host's own Navigator
 * settings already hide any view, and a second switch for the same thing would
 * leave the user with two places to look and no rule for which wins.
 *
 * `SettingsPage.component` takes no props, so `ctx` and the store arrive
 * through the registration closure in `index.tsx`. No `<h2>`: the host draws
 * the page title from `SettingsPage.title`.
 */

import { Section, Select, SettingRow, useServiceState } from "@silo-code/sdk";
import {
  defaultLabel,
  renameLabel,
  reorderLabels,
  setDefaultLabel,
} from "../lib/labels";
import type { SettingsStore } from "../lib/settings-store";
import { LabelList } from "./LabelList";

export function FollowUpsSettingsPage({ settings }: { settings: SettingsStore }) {
  const s = useServiceState(settings);
  return (
    <div className="fu-page">
      <div className="fu-body silo-scroll">
        <Section label="Labels">
          <p className="fu-hint">
            Name the five labels for the way you actually work — "Blocked",
            "Needs review". Drag a label to move it: that order is how labels
            are listed when you flag a tab, and how the Follow-ups view groups
            them.
          </p>
          <LabelList
            labels={s.labels}
            onRename={(id, name) =>
              settings.setLabels(renameLabel(s.labels, id, name))
            }
            onReorder={(from, to) =>
              settings.setLabels(reorderLabels(s.labels, from, to))
            }
          />
        </Section>
        <Section label="Flag button">
          <SettingRow
            label="Default label"
            hint="Clicking the Flag button on a tab marks it with this label. To use a different one, click the caret beside the Flag."
          >
            <Select
              value={defaultLabel(s.labels).id}
              onChange={(e) =>
                settings.setLabels(setDefaultLabel(s.labels, e.target.value))
              }
              aria-label="Default label"
            >
              {s.labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </Select>
          </SettingRow>
        </Section>
      </div>
    </div>
  );
}
