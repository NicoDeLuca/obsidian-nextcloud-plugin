# Obsidian Nextcloud Plugin

A modular Obsidian plugin that connects to Nextcloud once and provides individual
Nextcloud apps as modules. Runs on desktop and mobile (macOS, iPadOS, iOS) from a
single codebase.

**Cookbook module:** recipe list, a recipe view with temporary checkboxes for
ingredients and instructions, and editing/creating recipes as Markdown.

**Calendar module:** day, 3-day, 5-day, week and month views of your Nextcloud
calendars (CalDAV), show/hide calendars, and creating, editing and deleting events.

**Tasks module:** your Nextcloud Tasks lists (CalDAV) with a "Today" view,
subtasks, quick add, checking off, and editing due date, priority and notes.

**Deck module:** your Nextcloud Deck boards as Kanban columns; add cards, edit
title, description, due date, done state and labels, move cards (drag and drop on
desktop), archive and delete them.

**Activity module:** the Nextcloud activity feed with the server's filters
(all, by you, by others, files, calendar, …), grouped by day.

File sync is intentionally out of scope; use Remotely Sync for that.

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
   username and app password. Use **Test** to check the connection.
3. Open recipes from the ribbon (chef hat) or the command *Nextcloud: Open Cookbook recipes*.

The checkbox state is never saved: it resets whenever a recipe is opened again.

### Editing recipes

The pencil in a recipe's header opens it as Markdown; the plus in the recipe list
(or the command *New Cookbook recipe*) starts a new one. **Save** writes it back to
Cookbook. If the recipe was changed elsewhere in the meantime, you are asked before
it is overwritten. The image and nutrition data are kept as they are.

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

Open it from the ribbon (calendar icon) or the command *Nextcloud: Open calendar*.
Click an empty slot or **+** to create an event, click an event to see, edit or
delete it. The layers button shows or hides calendars. Recurring events are shown
but can't be edited yet; read-only calendars (e.g. birthdays) are shown only.

### Tasks

Open it from the ribbon (checklist icon) or the command *Nextcloud: Open tasks*.
Choose *Today*, *All lists* or a single list at the top; type into the field and
press Enter to add a task (in *Today* it is due today). Tick a task to complete it,
click it to edit or delete it. The double-check button shows completed tasks.
Recurring tasks are shown but can't be completed or edited yet.

### Deck

Open it from the ribbon (Kanban icon) or the command *Nextcloud: Open Deck* and pick
a board at the top. Type into "Add a card…" under a list and press Enter to add a
card. Click a card to edit it; *List* moves it to another list (on desktop you can
also drag cards). Assigning people and managing lists or boards is not supported yet.

### Activity

Open it from the ribbon (activity icon) or the command *Nextcloud: Open activity*.
Pick a filter at the top; **Load more** at the end fetches older entries. Clicking
an entry opens it in Nextcloud in your browser.

## Architecture

```
src/
├── main.ts              # loads settings, client and the enabled modules
├── settings.ts          # connection settings + one toggle per module
├── core/
│   ├── NextcloudClient.ts   # requestUrl + Basic Auth; the only code that talks to Nextcloud
│   ├── ModuleRegistry.ts    # loads/unloads modules based on the toggles
│   ├── CalDav.ts            # CalDAV access shared by calendar and tasks
│   └── types.ts
└── modules/
    ├── cookbook/            # one folder per Nextcloud app
    ├── calendar/
    ├── tasks/
    ├── deck/
    └── activity/
```

A module implements `NextcloudModule` and registers its views, commands and ribbon
icons through the `ModuleContext` it receives. Everything registered that way is
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

Enable the plugin under *Settings → Community plugins*. For phone and tablet, sync
the vault (including `main.js`, `manifest.json` and `styles.css`) to the devices.
