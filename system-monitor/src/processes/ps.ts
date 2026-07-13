// Pure `ps` output parsing — no ctx, no I/O. Works with the BSD-flavored `ps`
// on macOS and procps `ps` on Linux; both accept `-axo` with the same field
// names (busybox `ps` does not support `pgid` — see the controller for the
// degraded-mode fallback).

export const PS_ARGS = ["-axo", "pid=,ppid=,pgid=,rss=,pcpu=,comm="];

export interface PsProcess {
  pid: number;
  ppid: number;
  pgid: number;
  rssKb: number;
  cpuPercent: number;
  command: string;
}

// pid ppid pgid rss pcpu comm — the `=` suffixes in PS_ARGS drop the header,
// so every line is data. `comm` is last and unbounded: on macOS it's often a
// full path that can contain spaces (e.g. an app bundle's executable), so we
// anchor the five leading numeric fields and take everything after as-is.
const LINE_RE =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S.*?)\s*$/;

export function parsePsOutput(out: string): PsProcess[] {
  const rows: PsProcess[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, pid, ppid, pgid, rss, pcpu, command] = m;
    rows.push({
      pid: parseInt(pid, 10),
      ppid: parseInt(ppid, 10),
      pgid: parseInt(pgid, 10),
      rssKb: parseInt(rss, 10),
      cpuPercent: parseFloat(pcpu),
      command,
    });
  }
  return rows;
}
