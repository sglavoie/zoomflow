# Ask AI about a diagram

The collapsed **Ask AI** panel above the editor can send the current source, active board, and
your prompt to either Claude Code or Codex. Start the local app with `pnpm dev`,
install and sign in to the chosen CLI, then select it and click **Send**. Zoomflow
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
source editor stays visible. Provider environment fields are under **AI settings**.
For Claude Code, the `CLAUDE_CONFIG_DIR` field defaults to `~/.claude`;
`~` expands to your home directory, and relative paths resolve from the server's
working directory. Both providers accept environment overrides in the shared
field, one literal `NAME=value` per line (blank lines and `#` comment lines are
ignored). Values may contain `=`. The Claude config field takes precedence over
`CLAUDE_CONFIG_DIR` in the shared field. These values are passed only to the
selected CLI process and are kept in the current page, not saved by Zoomflow.

[Back to the workspace guide](workspace.md)
