/** skills.sh wordmark — sheet title bar, or compact toolbar entry. */
export function SkillsBrandMark({
  subtitle = "skills.sh",
  density = "sheet",
}: {
  /** Quiet trailing label — keep the same on list and drill-in. */
  subtitle?: string;
  /**
   * `"sheet"` — full SKILLS + subtitle for the browse-sheet chrome.
   * `"toolbar"` — compact `skills.sh` ghost mark for the panel action row.
   */
  density?: "sheet" | "toolbar";
}) {
  if (density === "toolbar") {
    return (
      <span
        className="skills-brand skills-brand--toolbar"
        title="skills.sh — The Open Agent Skills Ecosystem"
      >
        <span className="skills-brand-word" aria-hidden="true">
          <span className="skills-brand-ghost">skills.sh</span>
          <span className="skills-brand-fill">skills.sh</span>
        </span>
        <span className="skills-brand-sr">skills.sh</span>
      </span>
    );
  }

  return (
    <span
      className="skills-brand"
      title="skills.sh — The Open Agent Skills Ecosystem"
    >
      <span className="skills-brand-word" aria-hidden="true">
        <span className="skills-brand-ghost">SKILLS</span>
        <span className="skills-brand-fill">SKILLS</span>
      </span>
      <span className="skills-brand-sr">Skills</span>
      <span className="skills-brand-sub">{subtitle}</span>
    </span>
  );
}
