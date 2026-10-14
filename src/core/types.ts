import type { Command, Plugin, ViewCreator } from "obsidian";
import type { NextcloudClient } from "./NextcloudClient";

export interface NextcloudSettings {
	baseUrl: string;
	username: string;
	appPassword: string;
	/** Enabled state per module id. Missing entries count as enabled. */
	modules: Record<string, boolean>;
	/** Free-form data each module stores for itself, keyed by module id. */
	moduleData: Record<string, unknown>;
}

export const DEFAULT_SETTINGS: NextcloudSettings = {
	baseUrl: "",
	username: "",
	appPassword: "",
	modules: {},
	moduleData: {},
};

/** What a module gets from the core. Everything registered here is removed when the module is disabled. */
export interface ModuleContext {
	plugin: Plugin;
	client: NextcloudClient;
	registerView(type: string, creator: ViewCreator): void;
	addCommand(command: Command): void;
	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): void;
	/** The data this module saved last time, if any. */
	loadData<T>(): T | undefined;
	saveData(data: unknown): Promise<void>;
}

/** One Nextcloud app. New modules live in their own folder under src/modules/. */
export interface NextcloudModule {
	id: string;
	name: string;
	description: string;
	load(ctx: ModuleContext): void;
}
