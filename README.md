# Obsidian Nextcloud Plugin

A modular Obsidian plugin that connects to Nextcloud once and provides individual
Nextcloud apps as modules. Runs on desktop and mobile (macOS, iPadOS, iOS) from a
single codebase.

**Cookbook module:** recipe list, a recipe view with temporary checkboxes for
ingredients and instructions, and editing/creating recipes as Markdown.

**Calendar module:** day, 3-day, 5-day, week and month views of your Nextcloud
calendars (CalDAV), show/hide calendars, and creating, editing and deleting events.

**Tasks module:** your Nextcloud Tasks lists (CalDAV) with a "Heute" (today) view,
subtasks, quick add, checking off, and editing due date, priority and notes.

**Deck module:** your Nextcloud Deck boards as Kanban columns; add cards, edit
title, description, due date, done state and labels, move cards (drag and drop on
desktop), archive and delete them.

**Activity module:** the Nextcloud activity feed with the server's filters
(all, by you, by others, files, calendar, …), grouped by day.

**File sync module:** syncs the whole vault with a folder in your Nextcloud files,
at startup and periodically in the background (a replacement for Remotely Save).

The user interface is in German.

## Installation

Install the community plugin **BRAT** on each device, choose *Add beta plugin* and
enter `NicoDeLuca/obsidian-nextcloud-plugin`. BRAT installs and updates the plugin
from the GitHub releases, on desktop and mobile alike.

To publish a release: bump `version` in `manifest.json` and `package.json` and merge
to `main`. The *Release* workflow then tags the version and publishes the release;
pushes without a version bump are skipped.

## Setup

1. In Nextcloud, create an app password under *Settings → Security → Devices & sessions*.
2. In Obsidian, open *Settings → Nextcloud* and enter the URL (e.g. `https://cloud.example.de`),
   username and app password. Use **Testen** to check the connection.
3. Open recipes from the ribbon (chef hat) or the command *Nextcloud: Kochbuch-Rezepte öffnen*.

The checkbox state is never saved: it resets whenever a recipe is opened again.

### Editing recipes

The pencil in a recipe's header opens it as Markdown; the plus in the recipe list
(or the command *Neues Kochbuch-Rezept*) starts a new one. **Speichern** writes it back to
Cookbook. If the recipe was changed elsewhere in the meantime, you are asked before
it is overwritten. The image and nutrition data are kept as they are.

While you type, the editor keeps a draft (also across closing Obsidian). Opening
the recipe again offers to restore it; **Abbrechen** asks before discarding changes.

```markdown
---
portionen: 4
vorbereitung: 15 min
kochzeit: 1 h 20 min
gesamtzeit:
kategorie: Dessert
stichwörter: süß, schnell
quelle: https://example.com/rezept
---
# Pfannkuchen

Description (optional, any number of paragraphs).

## Zutaten
- 200 g Mehl
### Topping
- Ahornsirup

## Zubereitung
1. Alles verrühren.
2. In der Pfanne ausbacken.
   Indented lines continue the step above.

## Werkzeuge
- Pfanne
```

Durations accept e.g. `1 h 20 min`, `1h20m`, `2 Stunden`, `45 min` or `45`.

### Calendar

Open it from the ribbon (calendar icon) or the command *Nextcloud: Kalender öffnen*.
Click an empty slot or **+** to create an event, click an event to see, edit or
delete it. The layers button shows or hides calendars. Read-only calendars (e.g.
birthdays) are shown only.

Events can repeat daily, weekly (on chosen weekdays), monthly or yearly, every N
days/weeks/…, ending never, after a number of times or on a date. Editing or
deleting a recurring event asks whether it applies to *Nur dieser Termin*, *Dieser
und alle folgenden* (splits the series) or *Alle Termine der Serie*. Rules created elsewhere that
the form can't show (e.g. "every 2nd Tuesday") are kept unchanged.

### Tasks

Open it from the ribbon (checklist icon) or the command *Nextcloud: Aufgaben öffnen*.
Choose *Heute*, *Alle Listen* or a single list at the top; type into the field and
press Enter to add a task (in *Heute* it is due today). Tick a task to complete it,
click it to edit or delete it. The double-check button shows completed tasks.

Tasks can repeat like events. Ticking a repeating task moves its due date to the
next occurrence after today (missed ones are skipped); when the series has ended,
the task is completed.

### Deck

Open it from the ribbon (Kanban icon) or the command *Nextcloud: Deck öffnen* and pick
a board at the top. Type into "Karte hinzufügen …" under a list and press Enter to add a
card. Click a card to edit it; *Liste* moves it to another list (on desktop you can
also drag cards). Assigning people and managing lists or boards is not supported yet.

### Activity

Open it from the ribbon (activity icon) or the command *Nextcloud: Aktivitäten öffnen*.
Pick a filter at the top; **Mehr laden** at the end fetches older entries. Clicking
an entry opens it in Nextcloud in your browser.

### File sync

The module is off by default. Switch on *Datei-Sync* in the settings and enter the
*Nextcloud-Ordner* (e.g. `Obsidian/Notizen`; it is created if missing). The vault then
syncs a few seconds after Obsidian starts, every few minutes (*Automatisch
synchronisieren*) and from the ribbon (sync icon) or the command *Nextcloud: Dateien
jetzt synchronisieren*. On desktop the status bar shows the last sync time.

How it decides: each device remembers how every file looked after the last sync (its
own modification time and size, and the server's ETag). A file changed on one side is
copied to the other; a file deleted on one side is deleted on the other, but only if
the other side didn't change it meanwhile (then the changed version is restored).
Deleted files go to the vault's `.trash` folder or the Nextcloud trash bin.

- **Conflicts:** if a note changed on both devices, both versions are kept: the
  server's under the original name, yours as `Name (Konflikt <Gerätename> 2026-10-15 1430).md`.
  In the config folder, the newer version wins instead.
- **Config folder:** `.obsidian` (plugins, themes, hotkeys, …) is synced too, except
  `workspace.json`/`workspace-mobile.json` (open tabs), this plugin's own folder (it
  holds the app password and the device's sync state) and Remotely Save's folder.
  Switch it off with *Obsidian-Einstellungen mitsynchronisieren*.
- **Never synced:** `.trash`, `.git`, `node_modules`, `.DS_Store`, and hidden files
  inside normal folders (Obsidian doesn't see them).
- **Safety:** a sync that would delete more than 10 files and more than a quarter of
  all files stops and asks first (automatic syncs show a notice). If the Nextcloud
  folder disappears, the sync stops instead of deleting the vault. Pointing the module
  at another folder starts from scratch and never deletes anything on the first run.

Moving from Remotely Save (unencrypted WebDAV): disable Remotely Save, then enter its
remote folder here. The first sync compares the files on both sides (downloading
them once to compare their content); identical files are just recorded, differing ones
become conflict copies. Try it with a test vault and a separate test folder first.

## Architecture

```
src/
├── main.ts              # loads settings, client and the enabled modules
├── settings.ts          # connection settings + one toggle per module
├── core/
│   ├── NextcloudClient.ts   # requestUrl + Basic Auth; the only code that talks to Nextcloud
│   ├── ModuleRegistry.ts    # loads/unloads modules based on the toggles
│   ├── CalDav.ts            # CalDAV access shared by calendar and tasks
│   ├── recurrence.ts        # repeat rules (RRULE) + the shared "Repeat" form settings
│   └── types.ts
└── modules/
    ├── cookbook/            # one folder per Nextcloud app
    ├── calendar/
    ├── tasks/
    ├── deck/
    ├── activity/
    └── sync/                # vault sync over WebDAV
```

A module implements `NextcloudModule` and registers its views, commands, ribbon
icons and status bar items through the `ModuleContext` it receives; it can add its own
settings below its toggle (`renderSettings`). Everything registered that way is
removed again when the module is switched off. To add a module, create a folder
under `src/modules/` and add it to the list in `src/main.ts`.

Rules for mobile compatibility: network only through `requestUrl` (via the core
client), no Node modules (`fs`, `http`, `axios`, …).

## Development

```sh
cd <vault>/.obsidian/plugins/
git clone https://github.com/NicoDeLuca/obsidian-nextcloud-plugin.git
cd obsidian-nextcloud-plugin
npm install
npm run dev     # watch build to main.js
npm run build   # type-check + production build
```

Enable the plugin under *Settings → Community plugins*. For phone and tablet, install
it through BRAT (the sync module doesn't sync this plugin's own folder).
