# Working with diagrams

Start with the guide for the task you want to do:

- [Create flows, mind maps, and edit on the diagram](authoring.md)
- [Explore diagrams, edit source, and review lint checks](navigation.md)
- [Export diagrams, mobile editing, and keyboard controls](exporting.md)

## Workspace and drafts

New workspaces start with the canvas filling the workspace. **Source** in the header
opens the editor; the choice is remembered for each pane, including existing workspaces.
**Create / open** groups flow and mind-map creation with file and folder opening. Source-editing actions reveal the editor automatically.
**View** holds layout, theme, D2 reference, and keyboard shortcuts. On small screens,
Preview and Source tabs keep the diagram and editor usable one at a time.

The workspace opens local `.d2` files or a folder of related D2 files and starts
with the styled order drill-down example. Click the filename dropdown to explore the
built-in templates: order drill-down, flowchart basics, service architecture,
sequence diagrams, SQL schemas, layers / scenarios / steps, state transitions
with boundary ports, and a guided lint repair. Examples include source comments and use the built-in style library where needed;
no remote assets are required. The lint repair intentionally reports one error and one warning until fixed.
First-time opens start at the root board. Returning to an open document restores its
last board and breadcrumb trail, with zoom and pan remembered separately for each board
during the page session. Restoring an example resets its saved view. Source edits and
opened files remain in the dropdown and are backed up in browser storage for reload recovery. The
source toolbar reserves space for save status so saving does not move the editor.
Use **Save .d2** above the editor or **⌘S / Ctrl+S** to save a disk copy.
Use **Clear** beside Format to empty the current source and start from scratch.
The editor receives focus immediately; **⌘Z / Ctrl+Z** restores the cleared text.
Browsers with file-system access can write back to a file you opened or a destination
you choose, also after a reload: Zoomflow keeps each draft's file handle in browser
storage, and the browser may ask again for permission to edit the file when you
save. If permission is refused, Save asks where to save instead, without asking for that
permission again until you grant it in the browser's site settings, reopen the file, or reload the page. Other browsers download the source and label the button **Download .d2**.
**Export → Download .d2 source** always starts a separate download.
The status beside the save controls reports file state; its tooltip describes browser
recovery. Successful background backups stay quiet, while unavailable recovery is
shown explicitly. A disk save that takes longer than 700 ms shows progress.
If another program changed the file since Zoomflow opened or last saved it, Save
asks before overwriting it; cancelling leaves the file on disk unchanged. This also
applies after a reload, to files of an opened folder, and when the file cannot be
read to check. A file that was moved or deleted makes Save ask where to save instead.
While browser recovery is unavailable, leaving or reloading the page with edits
that are not saved to disk asks for confirmation first.
Saving an example creates a separate named draft, labeled with its original template.
The edits, undo history and diagram view move to that copy, and the example itself
returns to its original source, no longer marked **Modified**. The filename, browser tab, and subsequent exports use the chosen disk name.
An unsaved-change dot in the browser tab distinguishes edits from the last disk save.
The active filename also carries an unsaved dot, which stays visible during
compilation, formatting, errors, and exports. Browser recovery and downloads do
not clear it; saving to disk or undoing back to the saved source does.
Project import paths remain stable even when a file copy is saved under another name.
Browser storage can be cleared. Drafts are stored independently per document and tab;
simultaneous edits are preserved as **(recovered)** copies in the diagram menu after
reload. A notice names the drafts another tab changed; its **Reload** button keeps
this tab's latest edits in browser storage, then reloads to show every saved version. Recovered project files
retain their imports and can be exported as a project ZIP without replacing the
canonical file. Superseded revisions are reclaimed after their replacements are
saved, while concurrent versions are retained. Existing browser backups migrate automatically. The picker puts the
active project or draft first,
followed by other drafts ordered by edit time, then built-in examples. It marks
modified examples and shows edit timestamps and distinct draft numbers for same-name uploads.
**Restore** resets an example after confirmation; opened file drafts
can be removed from the dropdown. Confirmation dialogs name the affected document
or project and report unsaved changes. A 30-second **Undo** notice restores removed
drafts or the previous example, including its editor history and view. The timer pauses
while the notice has keyboard focus or the pointer is over it. Editing a restored
example retires its Restore undo, so undoing cannot overwrite new work. Removing
drafts and then undoing also restores their file handles.
Project files are grouped under their folder name;
unsaved files carry a dot and each project shows its unsaved-file count. These compare
source with the last file-save baseline, independently of browser recovery.
**Remove project** removes that project's browser drafts after confirmation and leaves disk files intact.
Inactive projects start collapsed when the picker opens; click their names to expand
them. With more than ten diagrams, a search field filters by filename, project,
path, or description and expands matching projects. Clearing the search restores
the active project's expanded view.
Each document keeps its own undo history, selection, and editor scroll position
while switching within the page. Restoring an example starts
a fresh history. Browser reload recovery saves source, not undo history.
The source lives in `apps/web/src/examples/`, with the catalog in `examples.ts`.

## Projects

### Keep an editable project with its view settings

Choose **Export → Download Zoomflow project** to download a `.zoomflow.zip` archive.
For one diagram it contains that diagram; for a project it contains every `.d2`
file, including unlinked files, files with source errors, and unsaved edits from
both panes. Each file keeps its relative path, hidden-node choices and connected-layer
settings, including custom branch selections. The selected file is the entry file.
Downloading while viewing the generated atlas map includes the project's sources
and opens at the file the map was opened from.

Use **Open Zoomflow project** in the filename menu, or drop the archive onto a pane,
to restore a separate editable project copy. It opens at the saved entry file with
its view settings; other files restore their own settings when opened. Existing
projects and disk files are kept. Relative imports and links continue to work.
The archive has no write access to the original folder: use **Save .d2** to choose
individual file destinations, or download an updated Zoomflow project to keep
subsequent edits and view changes together.

**This is an editable backup and includes hidden content.** Use SVG, PNG or
interactive HTML exports to share only the curated diagram. The source-only `.d2`
and project `.zip` downloads still omit view settings.

The archive is an ordinary ZIP with a versioned `zoomflow.json` manifest and D2
files under `sources/`. Archives support up to 10,000 files and 64 MiB of
uncompressed content. Invalid archives leave the open document intact; damaged or
unknown view metadata is ignored so its source can still be opened. Undo history,
temporary selection, zoom and pan are not included.

### Work with a folder

Open a project with **Open folder** (also in the filename menu on narrow screens).
Zoomflow loads its `.d2` files into a shared virtual filesystem, so relative imports
resolve from each file's folder. Pick another project file from the filename menu to
edit it; changes to imported files appear when you return to the main diagram.
When both files are open in split view, editing an import also refreshes the other
pane's preview and diagnostics. Exports wait for the updated preview.
Project drafts and their file handles survive reload in browser storage. In browsers
that support directory access, **Save .d2** writes the active project file to its
original folder, after a reload too. Other
browsers offer a Save dialog or source download. **Export → Download project .zip**
keeps all project sources and their relative paths together. Local image assets are
not yet loaded with folder projects.

In the filename menu, **Save all · N files** beside the project's unsaved count
saves every changed project file to its existing destination, including files in
both panes and files you are not viewing. Files save one at a time. The results
name each saved, skipped or failed file; **Save remaining files** retries what is
still unsaved. External disk changes ask before overwriting, as **Save .d2** does.
An edit arriving during saving stays marked unsaved until that version is saved.

Files without a destination or write permission, and files moved or deleted on
disk, are skipped and stay marked unsaved; **Save .d2** can choose a destination
for one file. **Download project ZIP** in the results keeps every current project
source and its relative path, including in browsers without direct folder writes.
Downloading does not clear the unsaved indicators. Recovered copies remain separate
and never overwrite canonical project files through Save all. **Cancel saving**,
Close or Escape stops queued saves; a write already running finishes and updates
that file's saved state. Files already saved stay on disk.

**Check project**, beside **Find in project** above the preview, checks every `.d2`
file in the folder, including unlinked files and unsaved edits in either pane.
It compiles the current sources before checking links against the target files'
current boards, so a renamed board is caught even when you have not opened its file.
Results group compiler errors and lint issues by the file being checked; imported
issues name their original source file. Choose an issue to open that location,
including in the other pane if it already shows the file. When no source location
is available, the issue opens its file without selecting a guessed location.

The check shows progress, error and warning counts, and uses the current **Lint
options**. **Cancel check**, Close or Escape stops queued work; an engine request
already running can finish, but its results are ignored. Cancelled checks label
their results as incomplete. Editing a source or changing check options clears the
old results; **Check again** starts a fresh check. Engine interruptions stop the
check separately from source errors, while a file that fails to compile does not
stop the remaining files from being checked. A check does not save or modify files.

## Link diagrams into an atlas

A shape or connection in one project file can open another file, so a folder becomes
one navigable atlas: an `index.d2` home board such as Life opens Health and Work, Work
opens a project, and that project opens its architecture. A folder opens at
`index.d2` (or `main.d2`) when it has one.

To start an atlas from nothing, choose **New atlas in an empty folder** in the filename
menu and pick or create an empty folder. Zoomflow writes an `index.d2` home board there,
a mind map whose root topic is named after the folder, and opens the folder as a project.
Select the root and choose **Add subtopic** (⌘/Ctrl+Enter) for each area, then
**New linked diagram…** on a topic to add the file it opens. A folder that
already has `.d2` files opens as a project unchanged. In browsers that cannot write to
folders, the atlas starts as a draft project named `atlas`: its files are drafts that
**Save .d2** or **Export → Download project .zip** keeps.

```d2
Health: {link: ./health.d2}
Work: {link: ./work/index.d2}
Zoomflow: {link: "./projects/zoomflow.d2#/Viewer"}
Home: {link: ../index.d2}
```

- **Syntax:** a file link is a path that starts with `./` or `../` and ends in `.d2`.
  It resolves from the linking file's folder, like an import, and must stay inside the
  project folder. A link written in an imported file resolves from that file's folder,
  except a `link:` at the top of the imported file, or one that two files both write on
  the same shape: D2 does not say which file wrote those, so they resolve from the file
  that imports them. The `./` matters: D2 reads `link: health.d2` or `link: work/plan.d2`
  as a board path and silently drops it; lint reports those as `bare-file-link` with
  the link to write instead. Paths with spaces work, for example `"./My Life.d2"`.
- **Fragments:** add `#/` and a board path to open another board of that file, written
  the way the address bar shows it there: `#/Sleep/Night`, or `#/Sleep/@scenarios/Night`
  for a scenario. Quote a link with a fragment, because an unquoted `#` starts a D2
  comment. Without a fragment the link opens the file's root board; a board that no
  longer exists opens its nearest existing ancestor with a notice, and lint warns
  (`missing-file-board`). A link to a file the project does not have is shown as
  missing and is a lint error (`dangling-file-link`).
- **Navigation:** clicking a file link (or Enter on it) opens that file in the same
  pane. Breadcrumbs start with the files you came through, so a crumb or Escape and
  Backspace on a file's root board return to the file that opened it, on the board you
  left. In the first pane, browser Back and Forward move across files too; the second
  pane follows links on its own and keeps its way through files in memory. Hovering a
  file link previews the board it opens. File links work only in folder projects: in a
  single opened file or an unsaved draft they are shown as missing with **Open the
  folder that contains this file to follow links to other diagrams.**
- **Authoring without syntax:** select or right-click a shape and choose **Link to
  diagram…** to pick another project file and, optionally, one of its boards, or **New
  linked diagram…** to name a new flow, mind map or empty diagram beside the current
  file. The new file is written to the project folder when the browser can write there
  (otherwise it is a project draft that **Save .d2** asks where to put), and it opens with
  breadcrumbs back to the shape that links it. A linked shape offers **Open diagram**,
  **Change linked diagram…** and **Remove link**. These links are written as
  `<shape>.link: "./x.d2"` lines in the board's attachment section, so **Edit flow** and
  **Edit mind map** keep working. Undo reverts each link change; a file that was
  created stays in the project.
- **Atlas map:** in the filename menu, **Atlas map**, first under a project's name, draws a
  read-only map of that project: every file as a shape and every file link as a
  connection, labelled with the board it opens when the link has a fragment. Files that
  no other file links to, apart from the home file, sit in a **Not linked from
  anywhere** group, so orphans stand out. Click a file to open it. The map is generated
  from the files' current sources each time you open it; it cannot be edited or saved
  over a project file (Ask AI still answers there, but does not apply source changes), and
  a reload shows the file you were on before it. A file that
  does not compile is drawn without its links.
- **Exports:** **Interactive atlas (HTML)**, offered for folder projects, bundles the
  current file and every file it reaches through file links into one offline HTML file
  with the same cross-file breadcrumbs, Escape and Back; other files use addresses like
  `#/@file/health.d2/Sleep`. **All boards as SVG (ZIP)** of a project file also includes
  the files it links to, each under `@files/<path>/`, with links rewritten to their root
  SVG. The command line lints with `--follow` and exports atlases the same way; see
  [Command line and CI](cli.md).
- **Limitations:** links to local files other than `.d2` and to files outside the
  project folder are not followed. Live diagnostics for an individual diagram use
  the linked file's last compile in this browser session; **Check project** checks
  every target against fresh sources. Opening a file that the other pane shows only says
  so. Images in folder projects are not loaded yet.

## Presentation and finishing touches

Steps with detail boards have a layered outline. Hover or focus one to preview
what is inside; its arrow opens the board, and the violet breadcrumb marks the
same depth. Filled diagrams distinguish ordinary steps, decisions and outcomes
with neutral, amber and green surfaces. Outline, Soft and Elevated show the same
sample flow in Style; Elevated also uses larger, heavier text and outlines.
Custom project colors remain authored colors.

Select a flow step and choose **Add next step** (or its nearby **+**) to insert a
step into its single outgoing path, keeping the connection label. **Add branch**
adds a separate outgoing path. A step with several outgoing paths offers Add
branch; use a particular connection's **+** to insert on that path. The new step
is ready to name immediately. Keyboard addition follows the same rule.

The first-use coach follows three actions: rename a step, add a step, and open a
detail board. Progress is remembered in this browser. Dismiss the coach at any
point to stop the sequence. Touch instructions use the shape's **More → Rename**
action. Contextual editing hints appear beside a selected shape.

Start **Walkthrough**, then choose **Present** to explain a diagram with the
editing controls hidden. A compact controller keeps Back, branch choices and
nested-board exploration available. The camera frames the current step and its
neighbors; manual input interrupts the motion, and reduced-motion preferences
skip it. **Exit presentation** or Escape returns to the walkthrough; its close
button ends the walkthrough. Presentation also works in offline HTML exports.

In **Export → Presentation**, set an optional display title and subtitle without
renaming the source file. For interactive HTML, choose the opening board and
whether the file opens in Explore, Walkthrough or Presentation mode. A link with
an explicit board fragment takes precedence over the opening-board choice.
Use **Open preview** to try the exact interactive export before downloading it.

For SVG and PNG images, enable **Presentation frame** for consistent padding and
an optional title and subtitle. The same frame is used by the image thumbnail,
downloads, PNG clipboard copies and images in ZIP exports. These presentation
preferences are remembered per document in this browser; they are not written
into D2 source or included in editable project backups.

The zoom status says **Fitted** when the diagram is at its overview scale;
**Overview** is the button that returns to that view. Hover either for an
explanation. Document headers show a readable title above the actual filename.
