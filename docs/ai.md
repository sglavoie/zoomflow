# Ask AI about a diagram

The collapsed **Ask AI** panel above the editor can send the current source, active board, and
your prompt to either Claude Code or Codex. Start the local app with `pnpm dev`,
install and sign in to the chosen CLI, select it under **AI settings**, and click **Send**. Zoomflow
runs `claude -p` or `codex exec` through a local Vite endpoint. A valid replacement
source becomes one undoable editor edit and updates the preview; questions can
return an answer without changing the diagram. Invalid D2 and CLI errors appear
beside the form, leaving your source untouched. If you edit or switch diagrams
while a request is running, its replacement is discarded. The AI endpoint is
available only on a local Vite dev or preview server, not in exported HTML or a
static build. The panel checks the selected CLI's installation and sign-in before
enabling **Send** and offers **Check again** if unavailable. Running requests show
elapsed time and a **Cancel** button; cancellation
stops the local CLI request and keeps the prompt for retry. **Undo AI change** restores
the previous source after an applied change and disappears when you edit or switch
documents; the normal editor undo history remains available. The AI panel and optional lint controls start collapsed so the
source editor stays visible. The prompt and Send/Cancel share a compact row above
availability and settings, including on phones. Additional settings scroll below
the composer; a bottom shadow indicates more content.

Applied edits highlight the affected source lines and show a clickable change count
beside **Undo AI change**. This feedback scrolls into view within the tools on
short screens without moving the editor or keyboard focus. Deletions highlight
their location in the resulting source.
Click the count to focus the first changed line, opening Source on narrow screens.
Highlights remain until **Dismiss highlights**, another source edit, or switching documents;
the Undo action remains available after dismissal. Asking another question keeps
the previous review controls until a new edit supersedes them. Separate edits keep
unchanged lines, selection, and the editor's scroll anchor intact. Large rewrites
may be grouped into a single highlighted region.

Provider and environment fields are under **AI settings**.
For Claude Code, the `CLAUDE_CONFIG_DIR` field defaults to `~/.claude`;
`~` expands to your home directory, and relative paths resolve from the server's
working directory. Both providers accept environment overrides in the shared
field, one literal `NAME=value` per line (blank lines and `#` comment lines are
ignored). Values may contain `=`. The Claude config field takes precedence over
`CLAUDE_CONFIG_DIR` in the shared field. These values are passed only to the
selected CLI process and are kept in the current page, not saved by Zoomflow.

## Error feedback

An unavailable server, timed-out availability check, or malformed response shows
a recovery action beside the prompt. Technical diagnostics are kept in a collapsed
**Technical details** section. **Check again** retries availability; successful
checks clear the previous error details. Failed requests keep your prompt and source.

[Back to the workspace guide](workspace.md)
