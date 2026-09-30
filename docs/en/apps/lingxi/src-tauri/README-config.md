<!-- English translation of `apps/lingxi/src-tauri/README-config.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Config directory

Lingxi puts **all** runtime data in one directory. It does not touch the source tree, and it does not write into the `.app` bundle (anything inside the bundle is gone on the next
build):

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/
├── settings.json          size / theme / camera / visibility / personality preset; a tray change is written to disk immediately
├── bridge-token           auth token for the local HTTP bridge, mode 0600, generated on first launch
├── memory.json            memories about the owner (plain text; the user can open and read it)
├── reminders.json         scheduled reminders
└── assets/                resources both the user and an agent can change
    ├── actions.json       action library        (replaced as a whole)
    ├── expressions.json   expression library    (replaced as a whole)
    ├── skins.json         themes                (merged with the built-in set)
    ├── face.json          feature geometry      (overridden field by field)
    ├── bubble.json        bubble style          (replaced as a whole)
    ├── reactions.json     task → reaction map   (overridden entry by entry)
    ├── textures/*.png     hand-drawn atlases / expression textures
    └── README.md          format notes (written by the application itself)
```

The installed build and the source build **share the same bundle id**, so they read the same directory — one change takes effect on both.

- Main window → "Appearance" → "Export built-in resources as a template" writes out the whole `assets/` set.
- After editing, `POST /control {"reloadAssets":true}`, then `GET /assets/status` to see the validation result.
- Each file is **validated on its own**: writing one badly does not affect the rest.
