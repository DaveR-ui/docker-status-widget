---
id: tools-readme
category: tools
tags: [tooling, dev-aids, verification, render-preview]
aliases: ["tools README", "tools/"]
related: [project, render-preview, verification-slice]
version: 1.0
status: active
---

# tools/

Developer and verification aids. Nothing in here ships in the plasmoid: the
shipped widget is exactly `package/io.github.daver-ui.dockerstatus/contents/`

- `render_preview.qml` — preview window harness; loads the shipped
  `FullRepresentation.qml` by `file://` URL (no copy, no KPackage change).
- `render_preview.py` — driver; sets up the preview state and saves PNGs.

Run from the repository root:

```sh
python3 tools/render_preview.py                      # all preview states
python3 tools/render_preview.py --state active       # one state
python3 tools/render_preview.py --platform wayland   # visible window instead of offscreen
```

Prerequisites: Qt 6 QML modules (`kirigami`, plasma components) and PyQt6
(`python-pyqt6` on Arch, `python3-pyqt6` on Debian/Ubuntu). No `package.json`,
no `npm install`, and not part of the tested path — `node --test tests/*.mjs`
never picks these up.

Output defaults to `/tmp/dockerstatus-render/`; PNGs are scratch and never
committed. What this proves, and what it cannot, is written down in
[docs/verification/render-preview.md](../docs/verification/render-preview.md).
