# Creating and editing diagrams

[Working with diagrams](workspace.md) · [Create and edit](authoring.md) · [Explore and inspect](navigation.md) · [Export and keyboard controls](exporting.md)

Selecting a node shows its frequent actions beside it; **More** opens the full menu.
New and moved nodes and their incoming connections briefly stand out. Destructive
canvas edits offer an **Undo** confirmation beside the diagram, valid until the next edit.
Adding a step or topic opens its name field immediately. A hint beside the field
shows **Enter** to save, **⌘/Ctrl+Enter** to save and add another, and **Esc** to cancel
the rename. The renamed shape stays in place while its layout updates.

## Create a flow without diagram syntax

Choose **New flow** in the header. Give the flow a name, choose a simple flow or
an approval example, and replace the step names with your own. Step types are
**Action**, **Decision**, and **Start / End**. Each connection draws an arrow
between the selected steps; optional labels such as Yes and No describe branches.
**Add step** connects the new step from the previous one automatically. Change
that connection or add others to make branches and loops. Removing a step also
removes its connections. Layout can run top to bottom or left to right.
After the steps and connections, expand **Appearance** and choose **Outline**, **Soft**, or **Elevated**. **Customize style**
contains the individual **Filled shapes**, **Compact text**, and **Shadows** controls.
The live diagram beside the form updates as you edit; mind map detail boards can
be explored there before applying changes. On phones the preview follows the fields. Connections labelled Yes or No are drawn green and dashed red.

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
project, change those classes in a [project style sheet](authoring.md#style-diagrams-consistently).
Flows saved before the builder used classes still reopen; applying changes rewrites
them with classes. It can reopen its own generated source, including
label edits that preserve its structure. Boards added from its steps, as described in
[Mix flows and mind maps](authoring.md#mix-flows-and-mind-maps), keep it editable. Adding other
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

**Create mind map**, **Edit mind map**, undo, discard confirmation and **Appearance** work as
in the flow builder. The generated D2 imports the [standard library](../stdlib/README.md)
on each board, so detail boards keep their styles when the map is attached inside another
diagram. Existing maps with one import still reopen and gain the detail imports when
edited. Label edits that keep the structure still reopen in the outline; other custom D2 makes **Edit mind map**
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
hand-written ones and a mind map's generated detail boards. Flows and mind maps can open
from each other at any depth. Attachments on detail boards follow their topics when the
parent outline changes. Imported boards, scenarios and steps are left alone.

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
the board too. On other shapes without a link, a click selects the source and keeps
focus on the diagram for branch moves. Enter or Alt+click focuses the source editor.

### Move mind map branches

Drag a topic onto another topic to make it a child of that topic. The whole branch
moves, including its subtopics, attached boards and file links. A highlighted topic
and the message beside the pointer show the new parent before you release. On touch
screens, hold the topic briefly before dragging; dragging immediately still pans.
Space + drag and middle-button dragging keep their usual pan behaviour.

For a list of parents, select a topic and choose **Move branch…** from **More** in its action bar
or right-click / Shift+F10 menu. Choose **New parent topic** and **Move branch**, or
click the new parent on the diagram. The list includes topics on other generated
detail boards of this mind map; topic paths distinguish similarly named branches.
Choose the central topic to make a subtopic a main branch.

Moves append the branch after the new parent's existing subtopics and preserve the
editable outline. Generated detail boards adjust to the new hierarchy, and the moved
topic stays selected. Undo and redo restore both the hierarchy and the topic's board.
In the connected layer view, you can drag between visible boards, including from a
mind map to a flow or from a flow to a mind map. See [Move between boards](authoring.md#move-between-boards).

The document's central topic cannot move. An attached mind map's central topic can
move its entire board to another parent. A branch cannot move into itself, its descendants
or its existing parent. Drops outside a valid topic and Escape cancel the drag.
Within one mind map, if a move would make a topic open both a generated
detail board and an attached board or file, an explanation appears and the source
stays unchanged; adjust **Detail boards** in the outline before trying that move.

### Move branches in flows and other diagrams

Drag a node onto another node to make the drop target its new upstream parent.
For example, dropping **Review** onto **Triage** replaces Review's incoming arrows
with arrows from Triage. Review's outgoing arrows, downstream nodes, groups, detail
boards and file links stay attached. The diagram lays out the changed connections
automatically. This works in builder flows and hand-written D2, including containers,
imported relationships, scenarios and steps.

Select a node and choose **Move branch…** from **More** in its action bar or right-click /
Shift+F10 menu to choose **New parent node** from a list. You can also click the new
parent on the diagram. Hold before dragging on touch screens; dragging immediately
still pans. Escape and invalid drops cancel, and undo/redo restores the connections
and selection. Builder flows remain editable with **Edit flow**.

When a node has several upstream parents, they all change to the new parent. Parallel
arrows retain their labels, styling and arrowheads; feedback loops inside the downstream
branch stay in place. A node with no upstream arrow gains one from its new parent. A drop
onto the node itself or its downstream branch is rejected to avoid a new cycle.
Left-pointing arrows follow their direction. Undirected and bidirectional connections
use the order in which their endpoints were written to identify the upstream parent.

Builder flow branches can also move to another flow or mind map as described below.
In hand-written D2, parents belong to the same board, and moves act on the board
containing the dragged node, even when another board has nodes with the same IDs.
Scenarios and steps keep D2's normal inheritance rules. In hand-written D2, the source
keeps its original declarations and adds connection overrides inside the relevant
local board. The new connection copies its current label and styling; edit that
override when changing it later. Imports themselves stay unchanged.

### Move between boards

Drop a flow step or mind-map topic onto a parent on another board. For example,
move **Pricing** and its subtopics under **Sign up**, or move the **Launched** flow
step under the **Short videos** topic. The drop target becomes the upstream parent.
The parent picker includes destinations on other local boards, so the same moves
are available from the keyboard or on touch screens.

The branch leaves its old owner and opens as an attached board under the new parent,
keeping its flow or mind-map editor, shapes, subtopics, internal connections and
attached boards or files. Moving the centre of an attached mind map, or an entire
attached flow, relocates the whole board. If the parent already opens another board
or file, a new child holds the moved branch while preserving the existing link.

Hidden-export choices follow their shapes, and the connected canvas reveals the
moved branch. Undo and redo restore the source, selection and view choices. Moves
into a branch's own topics, downstream steps or attached boards are rejected.

### Connect flow steps on the diagram

Select a step of a builder-created flow and choose **Connect to…** in its action bar,
or from its right-click / Shift+F10 menu. Enter an optional label, then click the
destination step on the same board. For keyboard use, choose **Destination step**
and press **Add connection**. You can make branches, loops back to an earlier step,
and more than one arrow between the same steps. Escape or **Cancel** leaves the flow
unchanged.

Click an arrow to select its connection. Change **Connection label** and press Enter
or **Apply label**, or choose **Delete connection**. A blank label removes the text;
Yes and No labels get the flow's usual branch colours. With an arrow focused, Enter
or F2 edits its label and Delete or Backspace removes the arrow. Arrow keys move
between steps and connections; Tab leaves the diagram. **Done** or Escape closes
the connection controls.

Each change supports the diagram's undo and redo keys, keeps attached boards and
the flow builder editable, and is saved in the D2 source. Connection editing also
works on flow boards in the connected layer view; both ends must be on the same
board. Mind map and custom D2 connections keep their existing behaviour.

## Find your way between boards

Turn on **Show all layers** inside **Boards** above the preview to expand the selected board and its
descendants on one connected canvas. Ancestors and sibling boards stay out of this
view: opening a child board focuses its subtree, and opening an ancestor broadens the
view again. Each child diagram connects to the shape that opens it, and keeps
its own layout. Zoom and pan to explore the combined view. Scenarios and steps keep
their separate views.

Use **Depth** and its **− / +** buttons to choose how many levels below the view's
starting board to show. **0** shows only that board, **1** includes its children,
and **2** includes its grandchildren. You can type a number and press Enter or
adjust one level at a time. The limit follows the starting board when you navigate
and stays in effect as the source changes. **Show all layers** removes the limit.
Individual switches remain available; an uneven selection reads **Custom** in the
depth field. Choosing a depth again applies that limit to every branch.

When a child board repeats the topic that opens it, the connected view shows that
topic once, on the parent board, and connects the child's branches directly to it.
The child's centre returns when you focus its board. Distinct entry nodes and other
topics with the same label stay separate; this changes the view without rewriting
the source. SVG and PNG exports use the same shared-root view.

Open **Boards** to show or hide individual layers with the checkboxes beside their
names. Hiding a parent collapses its descendants and remembers their choices; show
the parent again to restore them. Turn off **Show all layers** to return to the
selected board alone. Layer settings, including depth and custom branch selections,
are backed up with each document in this browser and restored after a reload when
browser storage is available. They do not change the D2 source.

Selecting a shape to edit keeps the connected canvas in place. Turn on **Show all
layers** from that selection to make its board the starting point, or open a board
through its arrow, **Boards**, or the breadcrumbs to focus it directly.

Shapes in expanded layers can still be selected, renamed and edited. The breadcrumbs
and editing controls follow the selected shape's board. SVG and PNG downloads include
the visible layers together; HTML and ZIP downloads still include the whole diagram.

**Find in diagram** above the preview searches board names and
shape labels throughout the current document, including nested boards, scenarios and
steps. Results show their board breadcrumbs. Choose a match to open its board and
frame and select the shape. Use ↓ and ↑ to move through matches, Enter to open one,
or Escape to close without changing boards. ⌘F / Ctrl+F in the source editor still
finds source text. Diagram search uses the latest successful preview; it updates when
edits compile and stays available on that preview if the source has an error.

For an open folder, **Find in project** searches board names and shape labels in every
`.d2` file, including files you have not visited, unlinked files, and unsaved edits.
Results show the file path and board breadcrumbs. Choose one to open the file and
frame and select its shape. Browser Back returns to where you searched from; Escape
and Backspace climb the destination's boards, then return to the file you came from.
A result already open in the other pane activates and reveals it there.

Project search indexes files one at a time and shows progress, with results available
as each file finishes. Files that cannot compile are listed with their errors while
matches from other files remain usable; **Retry search** retries failed files.
Closing search stops queued indexing. Reopening reuses successful results until a
project source changes; changes to imports also refresh diagrams that use them.
⌘⇧F / Ctrl+Shift+F opens project search in a folder, or diagram search for a single
document. **Find in diagram** remains available to search only the current preview.

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

