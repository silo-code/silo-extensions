import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  DotsThreeVertical,
  Sparkle,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  List,
  ListRow,
  SearchInput,
  Tooltip,
  useServiceState,
  type ExtensionContext,
  type ExtensionStorage,
} from "@silo-code/sdk";
import { onBrowseSheetRequest } from "./browse-intent";
import { BrowseSheet } from "./BrowseSheet";
import { scanInstalledSkills } from "./local-inventory";
import {
  agentRootsLabel,
  filterLocalSkills,
  pathToFileUrl,
  type LocalSkill,
} from "./skill-model";
import { SkillsBrandMark } from "./SkillsBrandMark";
import { confirmAndUninstallSkill } from "./uninstall-skill";

/** Markdown preview view type shared with docs-panel's SKILL.md opener. */
const MARKDOWN_PREVIEW_VIEW_TYPE = "silo.markdown-preview";

/** Staggered re-scan delays after a CLI install/remove — see scheduleInventoryRefresh. */
const INVENTORY_REFRESH_POLL_DELAYS_MS = [1200, 2800, 5000, 9000];

export function SkillsPanel({
  ctx,
  panelId,
  active,
  storage,
  hydrated,
}: {
  ctx: ExtensionContext;
  panelId: string;
  active: boolean;
  storage: ExtensionStorage;
  hydrated: boolean;
}) {
  const wsState = useServiceState(ctx.workspaces);
  const ws = wsState.all.find((w) => w.id === wsState.activeId) ?? null;

  const [home, setHome] = useState<string | null>(null);
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(() =>
    hydrated ? (storage.get<string>("filter", "") ?? "") : "",
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >(() =>
    hydrated
      ? (storage.get<Record<string, boolean>>("collapsedSections", {}) ?? {})
      : {},
  );

  useEffect(() => {
    if (!hydrated) return;
    setCollapsedSections(
      storage.get<Record<string, boolean>>("collapsedSections", {}) ?? {},
    );
  }, [hydrated, storage]);

  function toggleSection(id: string) {
    setCollapsedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (hydrated) storage.set("collapsedSections", next);
      return next;
    });
  }

  useEffect(() => {
    void ctx.system.homeDir().then(setHome).catch(() => setHome(null));
  }, [ctx.system]);

  useEffect(() => {
    if (!hydrated) return;
    setQuery(storage.get<string>("filter", "") ?? "");
  }, [hydrated, storage, ws?.id]);

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const next = await scanInstalledSkills({
        files: ctx.files,
        workspaceFolder: ws?.folder ?? null,
        home,
      });
      setSkills(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, [ctx.files, ws?.folder, home]);

  // CLI install/remove is fire-and-forget in a terminal — file watches often
  // miss home-scope roots, and a single delayed rescan races the CLI. Poll a
  // few times after mutations so the panel catches up without a manual refresh.
  const refreshTimersRef = useRef<number[]>([]);
  const clearRefreshTimers = useCallback(() => {
    for (const t of refreshTimersRef.current) clearTimeout(t);
    refreshTimersRef.current = [];
  }, []);
  useEffect(() => () => clearRefreshTimers(), [clearRefreshTimers]);

  const scheduleInventoryRefresh = useCallback(() => {
    clearRefreshTimers();
    for (const ms of INVENTORY_REFRESH_POLL_DELAYS_MS) {
      refreshTimersRef.current.push(
        setTimeout(() => {
          void refresh({ quiet: true });
        }, ms),
      );
    }
  }, [clearRefreshTimers, refresh]);

  const noteUninstalled = useCallback(
    (skillId: string, scope: LocalSkill["scope"]) => {
      setSkills((prev) =>
        prev.filter((s) => !(s.id === skillId && s.scope === scope)),
      );
      scheduleInventoryRefresh();
    },
    [scheduleInventoryRefresh],
  );

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  // Re-scan when skill roots change under the workspace or user home.
  useEffect(() => {
    if (!active) return;
    const relRoots = [
      ".agents/skills",
      ".claude/skills",
      ".cursor/skills",
      ".codex/skills",
    ];
    const watchPaths: string[] = [];
    if (ws?.folder) {
      for (const rel of relRoots) watchPaths.push(rel);
    }
    if (home) {
      for (const rel of relRoots) watchPaths.push(`${home}/${rel}`);
    }
    const disposers = watchPaths.map((p) => {
      try {
        return ctx.files.watch(p, () => {
          void refresh({ quiet: true });
        });
      } catch {
        return { dispose() {} };
      }
    });
    return () => {
      for (const d of disposers) d.dispose();
    };
  }, [active, ctx.files, ws?.folder, home, refresh]);

  // Snapshot-at-open props: `ctx.layout.openPanelSheet`'s `render` is captured
  // once, when the sheet opens (see SheetDialogHost — it doesn't re-invoke
  // `render` just because SkillsPanel re-renders). So `localSkills`/
  // `workspaceFolder` reflect the panel's state *at the moment the sheet was
  // opened*, not live afterward — same characteristic `ctx.ui.showModal`
  // content already has today.
  const openBrowseSheet = useCallback(() => {
    if (!ws) return;
    void ctx.layout.openPanelSheet(
      panelId,
      // BrowseSheet closes via the host `<Sheet>` chrome (its × / Escape);
      // it has nothing of its own to wire `close` to.
      () => (
        <BrowseSheet
          ctx={ctx}
          localSkills={skills}
          workspaceFolder={ws.folder}
          onInstalled={scheduleInventoryRefresh}
          onUninstalled={noteUninstalled}
        />
      ),
      {
        title: <SkillsBrandMark />,
        ariaLabel: "Browse skills.sh",
        width: 560,
        className: "skills-sheet",
      },
    );
  }, [ctx, panelId, ws, skills, scheduleInventoryRefresh, noteUninstalled]);

  useEffect(() => {
    return onBrowseSheetRequest(() => openBrowseSheet());
  }, [openBrowseSheet]);

  const visible = useMemo(
    () => filterLocalSkills(skills, query),
    [skills, query],
  );
  const projectSkills = visible.filter((s) => s.scope === "project");
  const userSkills = visible.filter((s) => s.scope === "user");

  function setFilter(value: string) {
    setQuery(value);
    if (hydrated) storage.set("filter", value);
  }

  function openSkill(skill: LocalSkill) {
    const loc =
      skill.locations.find((l) => l.skillMdPath) ?? skill.locations[0];
    if (!loc) return;
    const target = loc.skillMdPath ?? loc.dirPath;
    try {
      if (loc.skillMdPath) {
        // Same as docs-panel: rendered markdown in a replaceable preview tab.
        ctx.editors.open(loc.skillMdPath, {
          viewType: MARKDOWN_PREVIEW_VIEW_TYPE,
          preview: true,
          ...(ws?.id ? { workspaceId: ws.id } : {}),
        });
      } else {
        void ctx.ui.openExternal(pathToFileUrl(loc.dirPath));
      }
    } catch (err) {
      ctx.ui.notify(
        "error",
        `Could not open ${target}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function uninstallSkill(skill: LocalSkill) {
    void confirmAndUninstallSkill(ctx, {
      skillId: skill.id,
      skillName: skill.name,
      scope: skill.scope,
      workspaceFolder: ws?.folder ?? null,
      onUninstalled: () => noteUninstalled(skill.id, skill.scope),
    });
  }

  function openSkillMenu(skill: LocalSkill, anchor: HTMLElement) {
    void ctx.ui.showMenu({
      anchor,
      align: "end",
      items: [
        {
          label: "Open",
          run: () => openSkill(skill),
        },
        {
          label: "Uninstall",
          run: () => uninstallSkill(skill),
        },
      ],
    });
  }


  if (!ws) {
    return <div className="skills-panel placeholder">No active workspace.</div>;
  }

  return (
    <div className="skills-panel">
      <div className="skills-toolbar">
        <div className="skills-toolbar-actions">
          <Tooltip content="Browse the open agent skills ecosystem">
            <button
              type="button"
              className="skills-toolbar-browse"
              aria-label="Browse skills.sh"
              onClick={() => openBrowseSheet()}
            >
              <SkillsBrandMark density="toolbar" />
            </button>
          </Tooltip>
          <Tooltip content="Refresh installed skills">
            <button
              type="button"
              className="skills-toolbar-icon"
              aria-label="Refresh"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <ArrowsClockwise size={14} />
            </button>
          </Tooltip>
        </div>
        <SearchInput
          value={query}
          onValueChange={setFilter}
          placeholder="Filter installed skills…"
        />
      </div>

      <div className="skills-body silo-scroll">
        {error ? (
          <EmptyState
            title="Couldn’t scan skills"
            description={error}
            action={<Button onClick={() => void refresh()}>Retry</Button>}
          />
        ) : !loading && visible.length === 0 ? (
          <EmptyState
            icon={<Sparkle size="1.75em" />}
            title={query ? "No matching skills" : "No skills installed yet"}
            description={
              query
                ? "Try a different filter, or browse skills.sh to add one."
                : "Browse skills.sh to augment this workspace — installs land in project or user agent skill folders."
            }
            action={
              <Button variant="primary" onClick={() => openBrowseSheet()}>
                Browse skills.sh
              </Button>
            }
          />
        ) : (
          <>
            <SkillSection
              id="project"
              label="This workspace"
              skills={projectSkills}
              emptyHint={loading ? "Scanning…" : "None in project skill folders"}
              open={!collapsedSections["project"]}
              onToggle={() => toggleSection("project")}
              onOpen={(s) => openSkill(s)}
              onMenu={(s, el) => openSkillMenu(s, el)}
            />
            <SkillSection
              id="user"
              label="User"
              skills={userSkills}
              emptyHint={loading ? "Scanning…" : "None in user skill folders"}
              open={!collapsedSections["user"]}
              onToggle={() => toggleSection("user")}
              onOpen={(s) => openSkill(s)}
              onMenu={(s, el) => openSkillMenu(s, el)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function SkillSection({
  id,
  label,
  skills,
  emptyHint,
  open,
  onToggle,
  onOpen,
  onMenu,
}: {
  id: string;
  label: string;
  skills: LocalSkill[];
  emptyHint: string;
  open: boolean;
  onToggle: () => void;
  onOpen: (skill: LocalSkill) => void;
  onMenu: (skill: LocalSkill, anchor: HTMLElement) => void;
}) {
  return (
    <div className="skills-section">
      {/* Match git explorer CHANGES/STAGED: uppercase chrome header + chevron. */}
      <div
        className="skills-section-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`skills-section-${id}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="skills-section-chev" aria-hidden="true">
          {open ? (
            <CaretDown size="0.85em" weight="bold" />
          ) : (
            <CaretRight size="0.85em" weight="bold" />
          )}
        </span>
        <span className="skills-section-title">{label}</span>
        <span className="skills-section-count">
          <Badge size="sm">{skills.length}</Badge>
        </span>
      </div>
      {open ? (
        <div id={`skills-section-${id}`} className="skills-section-body">
          {skills.length === 0 ? (
            <p className="skills-section-empty">{emptyHint}</p>
          ) : (
            <List aria-label={label}>
              {skills.map((skill) => {
                const agents = agentRootsLabel(skill);
                return (
                  <ListRow
                    key={`${skill.scope}:${skill.id}`}
                    trailing={
                      <Tooltip content="More…">
                        <IconButton
                          size="sm"
                          variant="toolbar"
                          aria-label={`More actions for ${skill.name}`}
                          aria-haspopup="menu"
                          onClick={(e) => onMenu(skill, e.currentTarget)}
                        >
                          <DotsThreeVertical size="1em" weight="bold" />
                        </IconButton>
                      </Tooltip>
                    }
                    onSelect={() => onOpen(skill)}
                  >
                    <span className="skills-row-main">
                      <span className="skills-row-name">{skill.name}</span>
                      {skill.description ? (
                        <span className="skills-row-sub">
                          {skill.description}
                        </span>
                      ) : (
                        <span className="skills-row-sub">{skill.id}</span>
                      )}
                      {agents ? (
                        <span className="skills-row-agents" title={agents}>
                          {agents}
                        </span>
                      ) : null}
                    </span>
                  </ListRow>
                );
              })}
            </List>
          )}
        </div>
      ) : null}
    </div>
  );
}

