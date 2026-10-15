import { App, TFile, TFolder } from "obsidian";

/** A file in the vault; `path` is its real path (the map key may be a normalized form). */
export interface LocalEntry {
	path: string;
	mtime: number;
	size: number;
}

/**
 * The vault side of the sync. Normal files and folders go through the Vault API, so Obsidian
 * (open notes, the file explorer, links) notices the changes right away. Obsidian doesn't index
 * hidden ones, like the config folder: those go through the adapter directly.
 */
export class LocalVault {
	constructor(private app: App) {}

	/** Everything in the vault except what `skip` excludes (skipped folders are not descended into). */
	async list(skip: (path: string) => boolean): Promise<{ files: LocalEntry[]; folders: string[] }> {
		const files: LocalEntry[] = [];
		const folders: string[] = [];
		for (const f of this.app.vault.getAllLoadedFiles()) {
			if (skip(f.path)) continue;
			if (f instanceof TFile) files.push({ path: f.path, mtime: f.stat.mtime, size: f.stat.size });
			else if (f instanceof TFolder && !f.isRoot()) folders.push(f.path);
		}

		const adapter = this.app.vault.adapter;
		const walk = async (folder: string) => {
			const listed = await adapter.list(folder);
			for (const path of listed.files.map(clean)) {
				if (skip(path)) continue;
				const stat = await adapter.stat(path);
				if (stat?.type === "file") files.push({ path, mtime: stat.mtime, size: stat.size });
			}
			for (const path of listed.folders.map(clean)) {
				if (skip(path)) continue;
				folders.push(path);
				await walk(path);
			}
		};
		const root = await adapter.list("/");
		for (const path of root.files.map(clean)) {
			if (!isHidden(path) || skip(path)) continue;
			const stat = await adapter.stat(path);
			if (stat?.type === "file") files.push({ path, mtime: stat.mtime, size: stat.size });
		}
		for (const path of root.folders.map(clean)) {
			if (!isHidden(path) || skip(path)) continue;
			folders.push(path);
			await walk(path);
		}
		return { files, folders };
	}

	/** Current modification time and size, or null if the file is gone. */
	async stat(path: string): Promise<{ mtime: number; size: number } | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return { mtime: file.stat.mtime, size: file.stat.size };
		const stat = await this.app.vault.adapter.stat(path);
		return stat?.type === "file" ? { mtime: stat.mtime, size: stat.size } : null;
	}

	read(path: string): Promise<ArrayBuffer> {
		return this.app.vault.adapter.readBinary(path);
	}

	/** Creates or overwrites a file, with the given modification time. */
	async write(path: string, data: ArrayBuffer, mtime: number): Promise<void> {
		const vault = this.app.vault;
		if (isHidden(path)) {
			await this.mkdir(parent(path));
			await vault.adapter.writeBinary(path, data, { mtime });
			return;
		}
		const file = vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await vault.modifyBinary(file, data, { mtime });
		} else {
			await this.mkdir(parent(path));
			await vault.createBinary(path, data, { mtime });
		}
	}

	/** Moves a file or folder to the vault's .trash folder. */
	async trash(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file) await this.app.vault.trash(file, false);
		else if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.trashLocal(path);
	}

	/** Moves a folder to the trash, but only if it holds nothing except ignored files. */
	async trashFolderIfEmpty(path: string, ignored: (path: string) => boolean): Promise<boolean> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(path))) return true;
		const listed = await adapter.list(path);
		if ([...listed.files, ...listed.folders].some((p) => !ignored(clean(p)))) return false;
		await this.trash(path);
		return true;
	}

	/** Creates the folder and any missing parents. */
	async mkdir(path: string): Promise<void> {
		if (!path) return;
		const vault = this.app.vault;
		if (isHidden(path)) {
			if (!(await vault.adapter.exists(path))) await vault.adapter.mkdir(path);
			return;
		}
		if (vault.getAbstractFileByPath(path)) return;
		await this.mkdir(parent(path));
		await vault.createFolder(path);
	}
}

/** Files and folders Obsidian doesn't index: everything below a hidden folder in the vault root. */
export function isHidden(path: string): boolean {
	return path.startsWith(".");
}

function parent(path: string): string {
	return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function clean(path: string): string {
	return path.replace(/^\/+/, "");
}
