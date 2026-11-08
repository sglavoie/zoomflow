# Exporting diagrams and keyboard controls

[Working with diagrams](workspace.md) · [Create and edit](authoring.md) · [Explore and inspect](navigation.md) · [Export and keyboard controls](exporting.md)

## Export

To leave a node out of downloads, right-click it and choose **Hide from export**,
use the same button in its selection bar, or focus it and press **H**. Repeat to
unhide it. Hidden nodes remain dimmed and labeled **Hidden from export** in the
workspace, so they can still be selected and restored. Hiding a node also hides
its contained nodes, downstream children, and attached detail layers recursively.
Unhiding a descendant clears the parent choices hiding it too.
Other explicit visibility choices are preserved.

SVG, PNG, ZIP and interactive HTML downloads omit hidden nodes and their incident
connections, including from offline search. Downloads fit the remaining content
with a small margin, and combined-layer exports close gaps left by fully hidden
layers. The editor keeps its current layout and viewport.
The export menu reports the omitted count for the current file and scope.
**Reset export visibility** includes every shape on every board of the current
document again, including choices on boards you are not viewing. It keeps the
current layer layout. Visibility choices are backed up per document and board in
this browser and survive reloads when browser storage is available. They do not
change the D2 source or mark it as unsaved. Atlas and project ZIP exports respect
choices made in either pane, including saved choices for files not opened since
the last reload. Named copies keep independent choices.

Choices for deleted shapes and boards have no effect while those items are absent;
undoing the source deletion restores their curation. Reset also clears these inactive
choices. A missing layer starting board falls back to an existing board. Restoring
an example clears its curation, and undoing the restore brings it back.
Saving or downloading `.d2` source does not include view settings, and clearing
browser storage removes their browser backup. **Download Zoomflow project** keeps
the editable source and view settings together so they can be restored elsewhere.

Export offers **Interactive diagram (HTML)** for one navigable file with every
board, **Current board image (SVG)** and **Current board image (PNG)** for the
board on screen, and **All boards as SVG or PNG (ZIP)** for separate images. Project
files also offer **Interactive atlas (HTML)**. The main button names the download.
When PNG is selected, **Copy PNG** puts the same current board image on the clipboard
for pasting into another app. It uses the shown theme, export visibility and visible
layer layout. If clipboard access fails, use **Download PNG**. The HTML opens directly
from disk without a server or network connection and includes every board, including
cyclic links.
**Find in diagram** beside the zoom controls (⌘⇧F / Ctrl+Shift+F) searches board names
and shape labels across the exported diagram. Atlas exports offer **Find in atlas**
across every bundled file, with file paths and board breadcrumbs to distinguish matches.
Choose a result to open its board and frame and highlight its shape; use ↓ and ↑ to
move through results, Enter to open one, or Escape to close search. Search works
entirely offline, including boards you have not visited.
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
use `@scenarios/` and `@steps/` directories. Links between exported boards open their
SVG files; atlas file links keep their target board, including board fragments.
PNG uses the board's native dimensions
and has a 64 megapixel limit.
Static SVG and PNG images, including those in ZIP downloads, omit link glyphs.
Interactive HTML keeps its navigation badges.

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
[Edit on the diagram](authoring.md#edit-on-the-diagram); Tab and Shift+Tab still leave the diagram.
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
