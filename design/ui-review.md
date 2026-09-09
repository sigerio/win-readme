# UI update and verification

The application keeps its dark charcoal and green palette. This update improves auxiliary text contrast, removes continuous decorative animation, adapts preview padding to pane width, increases preview text to 15px and pane labels to 11px, and uses dark syntax highlighting. Highlighted text inherits its surrounding text color so it remains readable on the dark surface.

The file sidebar has a heading and an empty-state Open folder action. The document empty state explains the next step and retains Open file even when a workspace is already open. Tabs expose their full path on hover, and Save exposes its existing Ctrl+S shortcut.

The drag handlers, tab routing, document state, annotation transformations, filesystem implementation, and saved layout preferences remain in place. Layouts are not automatically collapsed: at 800px, users can collapse the sidebar and outline using the existing controls for more reading space.

## Verification

- `npm test`: both existing check programs pass, covering annotation transformations and rendering, document safety, preview panes, tab movement, paths, and workspace history.
- `npm run build`: TypeScript and Vite production build pass. Vite reports large bundle chunks; no dependencies were added.
- `scripts/check-ui.cjs`: browser checks run in the installed Windows Chrome 152, controlled by an existing Playwright installation. No browser download was needed.
- The initial browser run passed before the typography, preview padding, syntax theme, and empty-state changes. The same operations passed after those changes.

Browser coverage includes:

1. Annotation menus via keyboard and a context-menu event, text color, background color, clearing, restored selection/focus, and rendered highlight contrast.
2. Pointer dragging of sidebar, outline, editor/preview split and dual-preview split; mouse release stops resizing.
3. Outline navigation and editor-to-preview scrolling.
4. Preview splitting, pointer-driven cross-pane tab drag, an empty drop pane, and closing the split.
5. Cancelling close on an unsaved document and switching between all three view modes.
6. 800px, 1200px and 1600px layouts; sidebar/outline collapse and restoration; narrow-window reading space with both collapsed.
7. Persisted layout values and sidebar width after page reload.
8. Save failure preserves dirty content, Ctrl+S retries, and saved annotation content renders after reopening. **Filesystem IPC is simulated in memory.**
9. Dark code-block appearance and document empty-state file/folder actions. **Native file dialogs are simulated and cancelled.**
10. No uncaught browser page errors.
11. Workspace-root and nested-folder name clicks toggle expansion; root arrow and keyboard activation toggle once. Tab, annotation and file-tree menu bounds are checked against the invocation coordinates. Menus render in the document body to avoid offsets and clipping from animated workspace containers.

These checks cover frontend interaction in Chrome, not the packaged Windows WebView's native dialogs, actual disk writes, OS zoom, or installation. The native backend was not changed.

## Run browser checks

Start the Vite development server with `npm run dev`. Start an existing Chrome with a separate temporary profile and a local remote-debugging port. Set `PLAYWRIGHT_MODULE` to an existing Playwright package path, `CDP_URL` to that browser's endpoint, and optionally `APP_URL` (default `http://127.0.0.1:1420`). Then run:

```sh
node scripts/check-ui.cjs
```

Set `SCREENSHOT` to a PNG path to also capture split, reading, empty and viewport variants. The checks use an isolated browser context with temporary in-memory documents; they do not open or modify user documents.
