# Working with diagrams

## Create a flow without diagram syntax

Choose **New flow** in the header. Give the flow a name, choose a simple flow or
an approval example, and replace the step names with your own. Step types are
**Action**, **Decision**, and **Start / End**. Each connection draws an arrow
between the selected steps; optional labels such as Yes and No describe branches.
**Add step** connects the new step from the previous one automatically. Change
that connection or add others to make branches and loops. Removing a step also
removes its connections. Layout can run top to bottom or left to right.
Under **Look**, **Filled shapes**, **Compact text** and **Shadows** restyle every step
at once. Connections labelled Yes or No are drawn green and dashed red.

**Create flow** opens a separate, unsaved draft and keeps the current diagram in
the filename menu. **Edit flow** above the preview reopens the form, including
after browser recovery or reopening its saved `.d2` file. **Apply changes** is
undoable in the source editor; Cancel leaves the diagram unchanged. Closing the
builder with **Cancel**, **Close** or Escape after changing the form asks before
discarding those changes; an unchanged form closes at once. Save or
download a disk copy to keep your work.

The builder writes ordinary D2 that imports the [standard library](../stdlib/README.md)
and gives each step a class for its type: `zf-step`, `zf-decision` or `zf-terminal`.
The looks add `zf-filled`, `zf-compact` and `zf-shadow` after it, and Yes and No
lines get `zf-yes` and `zf-no`. To restyle every flow in a
project, change those classes in a [project style sheet](#style-diagrams-consistently).
Flows saved before the builder used classes still reopen; applying changes rewrites
them with classes. It can reopen its own generated source, including
label edits that preserve its structure. Boards added from its steps, as described in
[Mix flows and mind maps](#mix-flows-and-mind-maps), keep it editable. Adding other
custom D2 styling, boards, or syntax makes **Edit flow** unavailable so the form cannot
discard those additions. Continue editing those diagrams in the source editor.

## Create a mind map from an outline

Choose **New mind map** in the header, or **New mind map from an outline** in the
filename menu on narrower screens, and write one topic per line. The first line is
the central topic; indent a line to make it a subtopic of the line above it. Use spaces,
the **Indent** and **Outdent** buttons, or ⌘] / Ctrl+] and ⌘[ / Ctrl+[ for the selected
lines. Bullets (`-`, `*`, `+`) and Markdown heading marks are optional, so a pasted
Markdown list works as it is. Unindented lines after the first become main branches.

Each main branch gets its own colour, which its topics and lines keep on every board.
**Detail boards** keeps a large map readable: topics at the chosen level that have
subtopics link to a board of their own, with the topic at its centre. Click one to zoom
in; breadcrumbs, Esc and Backspace return to the parent. Deeper levels split again at
the same depth, and each board is named after its topic. Choose **Keep every topic on
one board** for a single board.

**Create mind map**, **Edit mind map**, undo, discard confirmation and **Look** work as
in the flow builder. The generated D2 imports the [standard library](../stdlib/README.md)
once, on the root board; detail boards inherit its mind map classes. Label edits that keep
the structure still reopen in the outline; other custom D2 makes **Edit mind map**
unavailable so the outline cannot discard it.

## Mix flows and mind maps

Any shape can open a board of its own, built with either builder, so a flow step can
open a mind map of ideas and a mind map topic can open the flow that carries it out.
Each board keeps its own layout, so a top-to-bottom flow can open a left-to-right map.
Choose **Flows & mind maps** in the filename menu for an example: a launch flow whose
planning step opens a mind map, with a topic on that map opening an onboarding flow.

Click a shape to select it: a blue ring marks it, and a bar beside it offers **Add flow
board** and **Add mind map board**. Right-click a shape, or focus it and press Shift+F10 or the
context menu key, for the same actions in a menu with **Select in source**. Right-clicking
or focusing a shape selects it, so the blue ring always marks the shape that keys and menus
act on. Click the background of the diagram to clear the selection. The builder starts
from the shape's label as the board name, and the new board opens once it is added.

**Edit flow** or **Edit mind map** above the preview edits the board on view, so drill
into a board to change it. A shape whose board a builder made offers **Edit flow
board** or **Edit mind map board** from its parent board. Every change is undoable in
the source editor.

Boards that open from a board's shapes are written at the end of that board's block,
after `# Boards that open from shapes on this board.`, as a `link` line and a `layers`
block per board. The builders rewrite only the text above that line, so a flow or mind
map stays editable with boards attached. If an edit would remove the step or topic a
board opens from, the builder explains which one instead of applying the change. Mind
map topics find their board again by their labels, so reorder topics freely but keep
a topic's name while it has a board. If the source changes while a builder is open, such
as from Ask AI, applying the form still works when its own board is unchanged; otherwise
the builder asks you to reopen it so it starts from the latest version.

Boards can be added to the root board and to any board declared once in the file, including
hand-written ones. Imported boards, scenarios and steps are left alone, as are a mind map's
detail boards: add boards from topics on the map's main board, or keep every topic on one
board.

## Edit on the diagram

Steps of a flow and topics of a mind map change right on the diagram, without opening
a builder. Click one to select it: a blue ring and halo mark it, focus stays on the
diagram, and a bar just below it (above it near the bottom edge) names it and offers the
same actions as these keys. The bar follows the shape as you pan and zoom. Its buttons
are for the pointer; from the keyboard, use these keys or Shift+F10.

- **F2** or double-click renames it. Enter applies the name and Escape cancels.
- **⌘/Ctrl+Enter** (or Insert) adds the next step after a flow step, or a subtopic under
  a topic, and starts naming it. ⌘/Ctrl+Enter while naming applies the name and adds
  another, so a map grows as fast as you type. Tab applies the name and leaves the shape
  selected.
- **Enter** on a mind map topic adds a sibling topic after it; on the central topic it
  adds a main branch. On a topic that opens a board, Enter opens the board instead.
- **Delete** or **Backspace** (the Mac delete key) removes the step and its connections,
  or the topic and its subtopics. A flow keeps at least one step. On a shape that cannot
  be removed, Backspace still goes up a board.
- **⌘Z / Ctrl+Z** undoes on the diagram as in the source editor, and ⌘⇧Z, Ctrl+Shift+Z
  or Ctrl+Y redoes.

A step or topic that opens a board opens it from its arrow badge, or with Enter when it
has focus. A click anywhere else on it selects it, so you can double-click to rename it
like any other step or topic. Hand-written diagrams keep whole-shape links.

Edits keep the builder's form, so **Edit flow** and **Edit mind map** still open, and
boards attached to steps and topics stay on them. A topic that opens a detail board
can be edited on the main board or as the centre of its own board; renaming it renames
the board too. Other shapes keep their usual behaviour: clicking one selects its source in the
editor.

## Find your way between boards

**Boards** above the preview lists every board of the document as a tree, marked with
the builder that writes it: **Flow**, **Mind map**, or **Part of mind map** for a map's
detail boards. Choose a board to open it, with breadcrumbs that follow the tree, or
**Edit** to open its builder. The list appears when a document has more than one board.

Hovering or focusing a link to another board shows a picture of that board with its
name and what it holds, such as **Flow · 4 steps**, so you can look before drilling in.
Going back up selects the shape that led down, with its actions in the bar, so a
board's builder or its neighbours are one step away.

The source editor follows the board on view: opening a board scrolls to its block, and
lines outside it are dimmed. Editing anywhere clears the dimming until the preview
updates. The root board's block is the whole document, so nothing is dimmed there.

## Style diagrams consistently

Give shapes a class for what they are, and define how each class looks in one place.
The [standard library](../stdlib/README.md) has classes for flows, mind maps, states,
connections, groups and swimlanes, icons, and general roles such as `zf-emphasis`,
`zf-muted` and `zf-external`; the builders write only these classes. Classes defined on
the root board also apply on every board below it.

For a project's own look, open its folder with **Open folder** and add a `zoomflow.d2`
beside your diagrams: a copy of the [bundled library](../stdlib/zoomflow.d2) with its
palette, theme colours or class styles changed, plus any classes of your own. It
replaces the bundled library for `...@zoomflow` in the browser and the
[command line](cli.md), so every diagram and builder output that imports it picks up
the change. A class that nothing defines
changes nothing, so lint warns about it.

## Workspace and drafts

The workspace opens local `.d2` files or a folder of related D2 files and starts
with `fixtures/order.d2` as an example. Click the filename dropdown to explore the
built-in templates: order drill-down, flowchart basics, service architecture,
sequence diagrams, SQL schemas, layers / scenarios / steps, state transitions
with boundary ports, and a guided lint repair. Every example includes source
comments and compiles without imports or remote assets. The lint repair intentionally reports one error and one warning until fixed.
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
permission again until the page reloads. Other browsers download the source and label the button **Download .d2**.
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

Open a project with **Open folder** (also in the filename menu on narrow screens).
Zoomflow loads its `.d2` files into a shared virtual filesystem, so relative imports
resolve from each file's folder. Pick another project file from the filename menu to
edit it; changes to imported files appear when you return to the main diagram.
Project drafts and their file handles survive reload in browser storage. In browsers
that support directory access, **Save .d2** writes the active project file to its
original folder, after a reload too. Other
browsers offer a Save dialog or source download. **Export → Download project .zip**
keeps all project sources and their relative paths together. Local image assets are
not yet loaded with folder projects.

## Explore a diagram

Click a linked shape to drill into a board. Breadcrumbs record the visited path,
trimming back to an earlier board whenever you revisit it so cycles do not repeat.
Guidance below the canvas names a detail board to explore, explains source selection
on hover or keyboard focus, and gives panning instructions after zooming. Touch
guidance uses tap and pinch controls. Empty boards show a small connection example
and **Edit source**, which focuses the editor without changing any source.
Esc or Backspace goes to the tree parent, and browser back/forward retraces your
navigation. Deep links such as `#/checkout/charge` open a board directly in the
loaded diagram. Child-board links show a downward arrow badge, links to ancestors show
an upward arrow, and links to other boards show a sideways arrow. External links show
an outward arrow. Hover or focus a link to identify its destination; hovering a shape
highlights its selectable boundary. These link cues also appear in exported HTML.
Open a `.d2` file or drop one onto the page; dropping several files opens the first
and says to drop one file at a time. Files are compiled locally
with D2's WASM worker. Light, dark and system themes use D2's generated palettes.
Theme and export format are remembered when browser storage is available. The appearance
selector is in the header, separate from **Export**, which closes on Escape and restores focus to its button.
Use the preview's +, − and Fit controls or the mouse wheel to zoom. Drag empty
space to pan, or hold Space and drag a shape or link; middle-button dragging also
pans. Touch dragging works after zooming. Each board opens fitted around its
rendered content. Edits on the same board preserve zoom and pan; returning to a board
restores its view.
The zoom readout says **Fit** at the fitted baseline; percentages describe magnification
relative to that fit. A hint below the canvas explains panning after zooming in.
Deep breadcrumb trails keep the first board, parent and current board visible on
one row. **Earlier boards** opens the intermediate visits; use arrows or Tab to
choose one, or Escape to close it without changing boards. Long names are truncated
visually but retain their full accessible names and tooltips. This also works in
exported HTML.
Keyboard navigation moves focus to the new board or breadcrumb and
announces its name.
Switching documents preserves the active Preview or Source pane.
On phones and tablets narrower than 1,000px, use the **Preview** and **Source** buttons to give each pane the full
workspace. The Source button includes diagnostic counts. When compilation fails,
Preview keeps the last good diagram and shows the error with a **Go to error** action
that opens and focuses the relevant source location. Selecting an unlinked shape
opens its source in the Source pane.

Drill-down navigation needs no boundary ports or library import. Inside a child
layer, the viewer shows its parent connections (for example, **From Browse** and
**To Receipt**) using the parent's directed edges. This also works for deep links
and offline HTML. If several parent nodes open the same layer, each node's context
is listed separately. These hints do not add nodes or guess internal connections.
`layers.name` targets a child of the current board; `_` targets its parent. A missing
child link that matches an ancestor's name suggests the corresponding `_` path.

## Edit and repair source

Edit the syntax-highlighted D2 source in the CodeMirror pane for a live preview
(350 ms debounce). Nested maps indent automatically, closing braces dedent, and the
gutter folds multiline maps, including layers, scenarios, and steps. Braces in
comments and multiline labels do not create folds.
Wrapped lines retain their leading indentation, with subtle guides for nesting.
Very deep continuation indentation is capped to leave reading room on small screens.
If compilation is already running, intermediate preview requests are replaced by the
newest edit. The running compilation finishes, and only a current result is displayed.
Click **Format** or press **Shift+Alt+F** in the editor to apply D2's automatic
source formatting, including nested indentation. Formatting is one undoable edit
and refreshes the preview. Whitespace formatting preserves the cursor's logical
position, selection and editor scroll. Invalid diagrams leave the source unchanged and show
a formatting error; edits made while formatting is running are preserved.
The compact, fixed-height status strip above the editor shares space between file
state, delayed progress, and diagnostic counts. Longer compiler messages remain
available in Diagnostics.
Formatting success messages return to the file status after four seconds; formatting
failures remain visible until another attempt or source change.
Healthy preview and lint checks stay quiet, leaving one stable file-status message.
Use **Diagnostics**, or press **⌘⇧M / Ctrl+Shift+M** in the editor, to open the
detailed list; the toolbar and editor stay in place through compilation failures and recovery.
Transient progress appears only after 700 ms so quick edits do not flash indicators;
source mapping and exports are invalidated immediately. Compiler errors replace the normal status with one summary emphasizing the
first issue's line and column, with **Go to error** focusing its source location,
and **Diagnostics** opens a file-aware list of issues. Each available location opens
the correct project file; issues without a usable location say so. The summary reserves its space
to keep the editor still, with inline diagnostics while the last good diagram is marked as the
previous preview. Export is disabled until the current source compiles;
an export already running is canceled if the source changes. Successful edits
preserve the current board, falling
back to its nearest existing ancestor if it was removed. Click a shape to select
its source identifier; selecting an identifier in the editor highlights its shape
on the current board without navigating. Use **Reveal in diagram** or **⌘⇧Enter /
Ctrl+Shift+Enter** to open the selected identifier's board. Reveal brings the selected
shape into view with minimal panning and zooms out only when needed to fit it. On
phones, this also opens
Preview. Linked shapes still navigate; Alt+click selects
their source without navigating. Source links pause while edits are uncompiled,
so an old diagram cannot select an outdated text range. Editor keyboard shortcuts,
including undo, search, Escape and Backspace, stay in the editor. Tab indents the
source; to leave the editor with the keyboard, press Esc, then Tab within two seconds.

## Syntax reference and workspace layout

The diagram is on the left and the source editor is on the right. Click **D2
reference** or press **⌘⇧/** on macOS, or **Ctrl+Shift+/** on Windows/Linux,
to toggle a syntax reference below the diagram. This shortcut also works while editing;
**⌘/** or **Ctrl+/** toggles D2 line comments in the editor.
The default desktop split gives each pane equal space near 1,100px, gradually
increasing the diagram share to 62% at 1,440px. Resizing the divider remembers your
chosen share; double-clicking restores the adaptive default. Phone source controls
use tighter spacing to leave more room for editing.
On phones and tablets, opening the reference reveals Preview and closing it returns focus to the source when opened from the editor.
The bundled reference works without a network connection once
the app is loaded, with searchable examples, copy buttons and links to the full D2
documentation. Each example is tested against the bundled compiler.
Reference snippets use the editor's syntax colors. Search highlights matching text,
and Copy briefly changes to **Copied** beside the snippet.

Drag the horizontal divider to resize the diagram/reference split, or focus it
and use Up/Down (5% steps) and Home/End (25%/75%). The split starts at 60% diagram
and 40% reference and remembers your size when browser storage is available.
Closing and reopening preserves the search and scroll position. Escape inside the
reference closes it and restores focus without navigating the diagram. On narrow
screens, the diagram and reference share the Preview pane. Zoom and fullscreen
controls sit in a toolbar below the canvas so they do not cover diagram content, including
in fullscreen. Export controls stay in their menu so the editor remains visible.

## Two diagrams side by side

Choose a **Layout** in the header to build two diagrams at once:

- **Single** shows one diagram beside its source.
- **Split · tabs** shows two documents side by side. Each pane has its own
  **Preview** and **Source** tabs.
- **Split · all views** shows both diagrams above their sources, so all four views
  are visible. Windows narrower than 1,400px show this layout as tabs.

The second pane starts empty: **Choose a diagram** opens the diagram menu for it,
and **Start empty** creates a blank `untitled.d2` draft. The filename button at the
top of each pane opens the menu for that pane and marks unsaved changes. A draft
opens in only one pane at a time; choosing the one shown in the other pane moves
focus there instead.

The pane you last clicked or focused is active, marked by a colored top edge. The
header filename menu, **Open .d2**, **Open folder**, **New flow**, **Export**,
**⌘S / Ctrl+S**, and the D2 reference act on the active pane. Dropping a file onto a
pane opens it there. Each pane previews, lints and navigates boards independently.
The first pane's board stays in the page address, and Escape or Backspace go up a
board only in the active pane. Lint options and AI settings apply to both panes.

Drag the divider between the panes, or focus it and use Left/Right and Home/End,
to resize them. In **Split · all views**, each pane's divider resizes its diagram and
source. Sizes, the layout and the second pane's document are remembered after a
reload. Returning to **Single** closes the second pane and keeps its draft in the
menu. On phones, a split shows one pane at a time; **Show the other diagram**
switches between them. The Layout control is hidden on screens 600px wide or narrower.

## Lint checks

Successful compilations also run Zoomflow lint. **Diagnostics** opens the
editor's diagnostic list. Missing board links are errors; unlinked layers are
warnings, as are links the viewer ignores (relative file paths such as `./x`, or
`_` above the root board), and classes that nothing defines, usually a misspelling or a
missing `...@zoomflow`. Classes on the root board are checked only when lint can follow
its imports; detail boards are always checked. `zf-in` and `zf-out` mark ports even
without the library, so they are never reported. **Check boundary ports** opts into explicit `zf-in`/`zf-out` validation;
boundary mismatches in layers that declare ports are errors only when this is
enabled. Port-free layers remain valid. **Check parent backlinks** enables an
additional, off-by-default warning for layers with no link back to their parent. Lint errors do not prevent preview or export.
Use `...@zoomflow` to import the bundled boundary ports, state pieces and default
theme; see [stdlib conventions and examples](../stdlib/README.md).

## Export

Export presents four choices by outcome, each with an explanation:
**Interactive diagram (HTML)** for one navigable file with every board, **Current
board image (SVG)** and **Current board image (PNG)** for the board on screen, and
**All boards as SVG (ZIP)** for every board as a separate SVG. The button names the
download: **Download HTML**, **Download SVG**, **Download PNG** or **Download SVG
ZIP**. The HTML opens directly from disk without a server or network connection
and includes every board, including cyclic links.
The export menu names the current board for SVG/PNG, or shows the total board count
for ZIP/HTML, and explains that HTML preserves offline drill-down navigation.
Until you choose a format, multi-board diagrams default to interactive HTML and
single-board diagrams default to SVG. An explicit format choice takes precedence
and is remembered when browser storage is available. One scope statement beside
Download identifies the current board or the whole diagram; while the source has
errors it says **Fix source errors to export.** Interactive HTML is titled with the
document name without its `.d2` extension.
SVG, PNG and ZIP exports keep the theme shown in the workspace; interactive HTML
follows its reader's light or dark color scheme. Remote images are embedded when
accessible; failed fetches produce a placeholder and a visible warning. ZIP paths follow the
board tree (`root.svg`, `checkout.svg`, `checkout/charge.svg`); scenarios and steps
use `@scenarios/` and `@steps/` directories. PNG uses the board's native dimensions
and has a 64 megapixel limit.

The viewer and browser/CLI exports use the same shipped Source Sans Pro Regular,
Bold, Italic and Semibold fonts, with embedded font subsets in SVG and HTML.
Single-file HTML shares one subset per face across its boards.
See [font assets, license and renderer wiring](../fonts/README.md).

## Mobile editing and keyboard controls

Expanded tools scroll independently to leave room for the source editor. The mobile
workspace follows the visible viewport when the software keyboard opens.

The diagram is one Tab stop. Use arrow keys to move spatially between shapes,
Home/End for the first/last shape, and Tab to leave for the canvas controls. Press +
or − to zoom (around the focused shape) and 0 to fit. While zoomed, Shift+arrows pan;
on a board without focusable shapes, plain arrows pan too. Focused
shapes are brought into view. Unlinked shapes with source locations are
keyboard-focusable: press Enter or Space
to select their source. Alt+Enter selects a linked shape’s source without navigating.
Steps and topics of builder boards add F2, ⌘/Ctrl+Enter, Enter and Delete, as described in
[Edit on the diagram](#edit-on-the-diagram); Tab and Shift+Tab still leave the diagram.
Escape first dismisses an open board preview card; press it again to go up a board.
Recompiling the same board retains focus on a surviving shape. Wheel zoom normalizes
pixel, line and page deltas; pinch zoom works from Fit. Touch devices show the pinch
hint even at Fit. Link badges stay 24 screen pixels across zoom levels, and touch hit areas
expand into available whitespace without covering neighboring shapes. The same
controls and link treatment ship in offline HTML.

If the diagram engine fails to load, **Retry preview** starts it again without
changing your source. Startup failures are separate from D2 diagnostics.

If a running preview takes more than 15 seconds, **Restart preview** offers a fresh
engine for the latest source. Waiting is also safe: there is no automatic restart.
Restart preserves source, undo history, and the last good diagram while the new
preview compiles.

[Ask AI](ai.md) · [Back to the quick start](../README.md)
