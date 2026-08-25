import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  CaretLeft,
  Check,
  CopySimple,
  DotsThreeVertical,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  List,
  ListRow,
  SearchInput,
  CheckboxRow,
  Tooltip,
  type ExtensionContext,
  type MenuEntry,
} from "@silo-code/sdk";
import { InstallSparkline } from "./InstallSparkline";
import { confirmAndInstallSkill } from "./install-skill";
import { confirmAndUninstallSkill } from "./uninstall-skill";
import { fetchSkillDescription } from "./skill-description";
import {
  annotateCatalog,
  buildInstallCommand,
  buildUninstallCommands,
  catalogKey,
  filterCatalogSkills,
  formatInstalls,
  skillsShUrl,
  type CatalogInstallFilter,
  type CatalogSkill,
  type CatalogSkillRow,
  type LocalSkill,
  type SkillScope,
  type SkillsShView,
} from "./skill-model";
import { fetchSkillsShPage, fetchSkillsShPages } from "./skills-sh-api";

const VIEW_CHIPS: { id: SkillsShView; label: string }[] = [
  { id: "trending", label: "trending" },
  { id: "hot", label: "hot" },
  { id: "all-time", label: "all-time" },
];

const SEED_PAGES = 2;

export function BrowseSheet({
  ctx,
  localSkills,
  workspaceFolder,
  onInstalled,
  onUninstalled,
}: {
  ctx: ExtensionContext;
  localSkills: readonly LocalSkill[];
  workspaceFolder: string | null;
  onInstalled: () => void;
  onUninstalled: (skillId: string, scope: SkillScope) => void;
}) {
  const [view, setView] = useState<SkillsShView>("trending");
  const [installFilter, setInstallFilter] =
    useState<CatalogInstallFilter>("all");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextPage, setNextPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogSkillRow | null>(null);

  const loadSeed = useCallback(
    async (v: SkillsShView) => {
      setLoading(true);
      setError(null);
      setSelected(null);
      setCatalog([]);
      setTotal(0);
      setHasMore(false);
      try {
        const result = await fetchSkillsShPages(ctx.net, v, SEED_PAGES);
        setCatalog(result.skills);
        setTotal(result.total);
        setHasMore(result.hasMore);
        setNextPage(result.pagesFetched);
      } catch (err) {
        setCatalog([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [ctx.net],
  );

  // A fresh instance mounts each time the sheet opens (the host, via
  // ctx.layout.openPanelSheet, only renders this while the sheet is open), so
  // there's no `open` flag to gate on — the initial `useState`s already start
  // clean, and this just (re)loads when the view chip changes.
  useEffect(() => {
    void loadSeed(view);
  }, [view, loadSeed]);

  const rows = useMemo(() => {
    const annotated = annotateCatalog(catalog, localSkills);
    return filterCatalogSkills(annotated, query, installFilter);
  }, [catalog, localSkills, query, installFilter]);

  // Keep the selected row's installed badges current when local inventory changes.
  const selectedRow = useMemo(() => {
    if (!selected) return null;
    return (
      annotateCatalog([selected], localSkills).find(
        (r) => catalogKey(r) === catalogKey(selected),
      ) ?? selected
    );
  }, [selected, localSkills]);

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchSkillsShPage(ctx.net, view, nextPage);
      setCatalog((prev) => {
        const byKey = new Map(prev.map((s) => [catalogKey(s), s]));
        for (const s of page.skills) byKey.set(catalogKey(s), s);
        return [...byKey.values()];
      });
      setTotal(page.total);
      setHasMore(page.hasMore);
      setNextPage(nextPage + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function runInstall(skill: CatalogSkill, scope: SkillScope) {
    void confirmAndInstallSkill(ctx, {
      skill,
      scope,
      workspaceFolder,
      onInstalled,
    });
  }

  function runUninstall(skill: CatalogSkill, scope: SkillScope) {
    void confirmAndUninstallSkill(ctx, {
      skillId: skill.skillId,
      skillName: skill.name,
      scope,
      workspaceFolder,
      onUninstalled: () => onUninstalled(skill.skillId, scope),
    });
  }

  return (
    <div
      className="skills-browse"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selectedRow) {
          e.preventDefault();
          e.stopPropagation();
          setSelected(null);
        }
      }}
    >
      {selectedRow ? (
        <SkillDetail
          ctx={ctx}
          skill={selectedRow}
          canProject={Boolean(workspaceFolder)}
          onBack={() => setSelected(null)}
          onInstall={(scope) => void runInstall(selectedRow, scope)}
          onUninstall={(scope) => void runUninstall(selectedRow, scope)}
        />
      ) : (
        <>
          <div className="skills-browse-toolbar">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search skills.sh…"
            />
            <div className="skills-views-row">
              <div
                className="skills-views"
                role="tablist"
                aria-label="Catalog filter"
              >
                {VIEW_CHIPS.map((chip) => {
                  const isActive = installFilter === "all" && view === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`skills-view${isActive ? " skills-view-active" : ""}`}
                      onClick={() => {
                        setInstallFilter("all");
                        setView(chip.id);
                      }}
                    >
                      {chip.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="tab"
                  aria-selected={installFilter === "installed"}
                  className={`skills-view${installFilter === "installed" ? " skills-view-active" : ""}`}
                  onClick={() => setInstallFilter("installed")}
                >
                  installed
                </button>
              </div>
              <div className="skills-browse-meta">
                {loading
                  ? "Loading catalog…"
                  : error
                    ? catalog.length > 0
                      ? `Couldn't load more — ${error}`
                      : error
                    : installFilter === "installed"
                      ? `${rows.length.toLocaleString()} installed in loaded pages`
                      : `Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()} on skills.sh`}
              </div>
            </div>
          </div>

          <div className="skills-browse-list silo-scroll">
            {loading ? (
              <CatalogListSkeleton />
            ) : error ? (
              <EmptyState
                title="Couldn’t reach skills.sh"
                description={error}
                action={
                  <Button onClick={() => void loadSeed(view)}>Retry</Button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<MagnifyingGlass size="1.75em" />}
                title={
                  installFilter === "installed"
                    ? query
                      ? "No installed matches"
                      : "No installed skills in loaded pages"
                    : query
                      ? "No matches in the loaded pages"
                      : "No skills"
                }
                description={
                  installFilter === "installed"
                    ? "Load more of the catalog, switch leaderboard view, or choose All."
                    : query
                      ? "Clear the filter or load more of the catalog."
                      : "Try another leaderboard view."
                }
              />
            ) : (
              <List aria-label="skills.sh catalog">
                {rows.map((skill) => (
                  <ListRow
                    key={catalogKey(skill)}
                    trailing={
                      <span className="skills-browse-trailing">
                        {skill.weeklyInstalls ? (
                          <InstallSparkline
                            values={skill.weeklyInstalls}
                            title="Weekly installs"
                          />
                        ) : null}
                        <span className="skills-installs">
                          {formatInstalls(skill.installs)}
                        </span>
                        {skill.isOfficial ? (
                          <Badge tone="accent">Official</Badge>
                        ) : null}
                        {skill.installedScopes.length > 0 ? (
                          <Badge tone="ok">Installed</Badge>
                        ) : null}
                      </span>
                    }
                    onSelect={() => setSelected(skill)}
                  >
                    <span className="skills-row-main">
                      <span className="skills-row-name">{skill.name}</span>
                      <span className="skills-row-sub">{skill.source}</span>
                    </span>
                  </ListRow>
                ))}
              </List>
            )}
            {hasMore && !loading ? (
              <div className="skills-browse-more">
                <Button disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "Loading…" : error ? "Retry" : "Load more"}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function CatalogListSkeleton() {
  const widths = [
    { name: "42%", source: "28%", trail: "2.5em" },
    { name: "58%", source: "36%", trail: "3em" },
    { name: "35%", source: "22%", trail: "2.25em" },
    { name: "64%", source: "40%", trail: "2.75em" },
    { name: "48%", source: "30%", trail: "2.5em" },
    { name: "55%", source: "34%", trail: "3.25em" },
    { name: "38%", source: "24%", trail: "2em" },
    { name: "50%", source: "32%", trail: "2.75em" },
  ] as const;

  return (
    <div
      className="skills-browse-skeleton"
      aria-busy="true"
      aria-label="Loading catalog"
    >
      {widths.map((w, i) => (
        <div key={i} className="skills-browse-skeleton-row">
          <span className="skills-browse-skeleton-main">
            <span
              className="skills-skeleton-line"
              style={{ width: w.name, animationDelay: `${i * 0.05}s` }}
            />
            <span
              className="skills-skeleton-line skills-skeleton-line--sub"
              style={{
                width: w.source,
                animationDelay: `${i * 0.05 + 0.08}s`,
              }}
            />
          </span>
          <span
            className="skills-skeleton-line skills-skeleton-line--trail"
            style={{ width: w.trail, animationDelay: `${i * 0.05 + 0.04}s` }}
          />
        </div>
      ))}
    </div>
  );
}

function SkillDetail({
  ctx,
  skill,
  canProject,
  onBack,
  onInstall,
  onUninstall,
}: {
  ctx: ExtensionContext;
  skill: CatalogSkillRow;
  canProject: boolean;
  onBack: () => void;
  onInstall: (scope: SkillScope) => void;
  onUninstall: (scope: SkillScope) => void;
}) {
  const { net } = ctx;
  const [installScope, setInstallScope] = useState<SkillScope>(
    canProject ? "project" : "user",
  );
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [description, setDescription] = useState<string | null>(null);
  const [descStatus, setDescStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    setInstallScope(canProject ? "project" : "user");
  }, [skill.skillId, canProject]);

  useEffect(() => {
    let cancelled = false;
    setDescStatus("loading");
    setDescription(null);
    void fetchSkillDescription(net, skill)
      .then((text) => {
        if (cancelled) return;
        setDescription(text);
        setDescStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setDescription(null);
        setDescStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key off identity, not object churn
  }, [net, skill.source, skill.skillId]);

  const isInstalled = skill.installedScopes.length > 0;
  const uninstallCmds = buildUninstallCommands(skill);
  const effectiveInstallScope: SkillScope = canProject ? installScope : "user";
  const installCmd = buildInstallCommand(skill, {
    scope: effectiveInstallScope,
  });

  useEffect(() => {
    setCopiedCmd(null);
  }, [installCmd, skill.installedScopes.join(",")]);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    };
  }, []);

  function copyCommand(cmd: string) {
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCmd(cmd);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => {
        setCopiedCmd((cur) => (cur === cmd ? null : cur));
      }, 1500);
    });
  }
  function openOnSite() {
    void ctx.ui.openExternal(skillsShUrl(skill));
  }

  function openOverflow(anchor: HTMLElement) {
    const installedProject = skill.installedScopes.includes("project");
    const installedUser = skill.installedScopes.includes("user");
    const items: MenuEntry[] = [
      {
        label: "Open on skills.sh",
        run: openOnSite,
      },
      { type: "separator" },
    ];
    if (installedProject) {
      items.push({
        label: "Uninstall from project",
        run: () => onUninstall("project"),
      });
    } else {
      items.push({
        label: "Install in project",
        disabled: !canProject,
        title: canProject
          ? undefined
          : "No active workspace folder — open a workspace to install here.",
        run: () => onInstall("project"),
      });
    }
    if (installedUser) {
      items.push({
        label: "Uninstall from user scope",
        run: () => onUninstall("user"),
      });
    } else {
      items.push({
        label: "Install in user scope",
        run: () => onInstall("user"),
      });
    }
    void ctx.ui.showMenu({ anchor, items });
  }

  return (
    <div className="skills-detail silo-scroll">
      <div className="skills-detail-nav">
        <button type="button" className="skills-back" onClick={onBack}>
          <CaretLeft size={14} weight="bold" />
          Back
        </button>
        <div className="skills-detail-nav-tools">
          <Tooltip content="Open on skills.sh">
            <IconButton
              size="sm"
              variant="toolbar"
              aria-label="Open on skills.sh"
              onClick={openOnSite}
            >
              <ArrowSquareOut size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content="More…">
            <IconButton
              size="sm"
              variant="toolbar"
              aria-label="More actions"
              aria-haspopup="menu"
              onClick={(e) => openOverflow(e.currentTarget)}
            >
              <DotsThreeVertical size={14} weight="bold" />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="skills-detail-head">
        <div className="skills-detail-title-block">
          <h2 className="skills-detail-title">{skill.name}</h2>
          <div className="skills-detail-badges">
            {skill.isOfficial ? <Badge tone="accent">Official</Badge> : null}
            {skill.installedScopes.map((s) => (
              <Badge key={s} tone="ok">
                {s === "project" ? "In project" : "In user"}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <p className="skills-detail-source">{skill.source}</p>
      <p className="skills-detail-stats">
        <span className="skills-installs-hi">
          {formatInstalls(skill.installs)}
        </span>{" "}
        installs
        {skill.weeklyInstalls ? (
          <>
            {" "}
            ·{" "}
            <InstallSparkline
              values={skill.weeklyInstalls}
              title="Weekly installs"
            />
          </>
        ) : null}
      </p>

      <div className="skills-detail-divider" />

      <section className="skills-detail-section">
        <h3 className="skills-detail-section-title">Summary</h3>
        {descStatus === "loading" ? (
          <div
            className="skills-detail-skeleton"
            aria-busy="true"
            aria-label="Loading summary"
          >
            <span
              className="skills-detail-skeleton-line"
              style={{ width: "100%" }}
            />
            <span
              className="skills-detail-skeleton-line"
              style={{ width: "94%" }}
            />
            <span
              className="skills-detail-skeleton-line"
              style={{ width: "72%" }}
            />
          </div>
        ) : description ? (
          <p className="skills-detail-description">{description}</p>
        ) : (
          <p className="skills-detail-hint">
            {descStatus === "error"
              ? "Couldn’t load a summary from skills.sh."
              : "No summary published for this skill."}
          </p>
        )}
      </section>

      <section className="skills-detail-section">
        <h3 className="skills-detail-section-title">
          {isInstalled ? "Uninstall" : "Install"}
        </h3>
        {isInstalled ? (
          <div className="skills-detail-cmd-list">
            {uninstallCmds.map(({ scope, cmd, label }) => (
              <div key={scope} className="skills-detail-cmd-block">
                {uninstallCmds.length > 1 ? (
                  <p className="skills-detail-cmd-caption">{label}</p>
                ) : null}
                <CommandBlock
                  cmd={cmd}
                  copied={copiedCmd === cmd}
                  onCopy={() => copyCommand(cmd)}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            <CommandBlock
              cmd={installCmd}
              copied={copiedCmd === installCmd}
              onCopy={() => copyCommand(installCmd)}
            />
            <div className="skills-detail-cmd-options">
              <CheckboxRow
                label="Install into user scope"
                checked={effectiveInstallScope === "user"}
                disabled={!canProject}
                onChange={(checked) =>
                  setInstallScope(checked ? "user" : "project")
                }
                title={
                  canProject
                    ? undefined
                    : "No active workspace folder — installs go to user scope."
                }
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function CommandBlock({
  cmd,
  copied,
  onCopy,
}: {
  cmd: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="skills-detail-cmd-wrap">
      <code className="skills-detail-cmd">{cmd}</code>
      <Tooltip content={copied ? "Copied" : "Copy command"}>
        <IconButton
          size="sm"
          variant="toolbar"
          aria-label={copied ? "Copied" : "Copy command"}
          className="skills-detail-cmd-copy"
          onClick={onCopy}
        >
          {copied ? (
            <Check size={14} weight="bold" />
          ) : (
            <CopySimple size={14} />
          )}
        </IconButton>
      </Tooltip>
    </div>
  );
}
