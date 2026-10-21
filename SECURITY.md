# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/sglavoie/zoomflow/security/advisories/new)
rather than in a public issue. Include the steps to reproduce, the affected
version or commit, and the impact you observed. You should receive a reply within
a week.

Only the latest commit on `main` is supported; there are no maintained release
branches.

## Scope

Zoomflow compiles diagrams in the browser and has no hosted service. The areas
most worth reporting are:

- The local **Ask AI** endpoint (`apps/web/ai-server.ts`), which runs the
  Claude Code or Codex CLI on your computer. Its intended boundaries are
  described in [Ask AI → Security](docs/ai.md#security).
- Exported HTML files and the viewer's SVG sanitizing (`packages/viewer`), which
  must not run script from untrusted diagram source.
- The CLI (`packages/cli`) when it reads untrusted `.d2` projects.

Prompt injection through diagram text is a known limitation of AI assistance, not
a vulnerability on its own; a report is welcome when it crosses one of the
documented boundaries above.
