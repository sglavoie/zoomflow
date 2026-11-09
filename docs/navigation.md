# Exploring and inspecting diagrams

[Working with diagrams](workspace.md) · [Create and edit](authoring.md) · [Explore and inspect](navigation.md) · [Export and keyboard controls](exporting.md)

## Explore a diagram

Click a linked shape to drill into a board. The view zooms through the linked node;
returning briefly highlights that node. Ordinary pointer movement lets the transition finish.
Scrolling or dragging interrupts motion,
and reduced-motion preferences skip zooming. The root breadcrumb uses the document name. Breadcrumbs record the visited path,
trimming back to an earlier board whenever you revisit it so cycles do not repeat.
Guidance below the canvas names a detail board to explore, explains source selection
on hover or keyboard focus, and gives panning instructions after zooming. Touch
guidance uses tap and pinch controls. Empty local boards offer **Add first step** and **Start mind map**. Custom empty
boards retain their source guidance and **Edit source** action.
Esc or Backspace goes to the tree parent, and browser back/forward retraces your
navigation. Deep links such as `#/checkout/charge` open a board directly in the
loaded diagram. Child-board links show a downward arrow badge, links to ancestors show
an upward arrow, and links to other boards show a sideways arrow. External links show
an outward arrow. Hover or focus a link to identify its destination; hovering a shape
highlights its shape. Board previews show a cropped thumbnail and the names of the
steps or topics inside; the preview replaces redundant hover hints. Keyboard focus
keeps a distinct outline. Link badges also appear in exported HTML.
Open a `.d2` file or drop one onto the page; dropping several files opens the first
and says to drop one file at a time. Files are compiled locally
with D2's WASM worker. Light, dark and system themes use D2's generated palettes.
Theme and export format are remembered when browser storage is available. The appearance
selector is under **View** in the header, separate from **Export**, which closes on Escape and restores focus to its button.
Use the preview's +, − and **Overview** controls or the mouse wheel to zoom. Drag empty
space to pan, or hold Space and drag a shape or link; middle-button dragging also
pans. Touch dragging works after zooming. Small diagrams open at a comfortable
reading size. Phones start closer when labels would otherwise be too small;
**Overview** (or **0**) shows the whole diagram. Edits preserve zoom and pan, and
renaming a focused shape keeps its centre and scale in place through layout changes.
Returning to a board restores its view.
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
editor's diagnostic list. Missing board links and links to missing project files are
errors (see [Link diagrams into an atlas](workspace.md#link-diagrams-into-an-atlas)); unlinked layers are
warnings, as are links the viewer ignores (relative paths such as `./x` that are not
`.d2` files, or `_` above the root board), and classes that nothing defines, usually a misspelling or a
missing `...@zoomflow`. Classes on the root board are checked only when lint can follow
its imports; detail boards are always checked. `zf-in` and `zf-out` mark ports even
without the library, so they are never reported. **Check boundary ports** opts into explicit `zf-in`/`zf-out` validation;
boundary mismatches in layers that declare ports are errors only when this is
enabled. Port-free layers remain valid. **Check parent backlinks** enables an
additional, off-by-default warning for layers with no link back to their parent. Lint errors do not prevent preview or export.
Use `...@zoomflow` to import the bundled boundary ports, state pieces and default
theme; see [stdlib conventions and examples](../stdlib/README.md).


## Walk through a process

Choose **Walkthrough** above the canvas to begin at the selected step, or the first
step of the board. **Next** follows a single connection; at a decision, choose the
labelled branch to explain. **Explore** enters a linked detail board. At its last
step, return to the parent process and continue. **Back** retraces your chosen path.
You can also select another shape to change direction. Unvisited shapes and
connections dim, keeping attention on the path. **Finish**, the close button, or
Escape ends the walkthrough. Editing the source or navigating outside it ends it too.

Interactive HTML exports include the same controls and graph, so readers can choose
their own paths offline. Hidden export content is excluded. Walkthrough paths are
chosen for the current viewing session; they do not alter the diagram source.
