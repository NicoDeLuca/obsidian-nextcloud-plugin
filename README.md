# Obsidian Nextcloud Plugin

A modular Obsidian plugin that connects to Nextcloud once and provides individual
Nextcloud apps as modules. Runs on desktop and mobile (macOS, iPadOS, iOS) from a
single codebase.

**Phase 1:** read-only Nextcloud Cookbook: recipe list and a recipe view with
temporary checkboxes for ingredients and instructions.

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

## Architecture

```
src/
├── main.ts              # loads settings, client and the enabled modules
├── settings.ts          # connection settings + one toggle per module
├── core/
│   ├── NextcloudClient.ts   # requestUrl + Basic Auth; the only code that talks to Nextcloud
│   ├── ModuleRegistry.ts    # loads/unloads modules based on the toggles
│   └── types.ts
└── modules/
    └── cookbook/            # one folder per Nextcloud app
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
