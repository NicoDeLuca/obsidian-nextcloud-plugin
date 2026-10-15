import { LocalVault } from "./LocalVault";
import { Action, conflictPath, countDeletions, isMassDeletion, LocalFile, planFolders, planSync, RemoteFile, SyncedFile } from "./planner";
import { FolderCache, status, WebDavRemote } from "./WebDavRemote";

/** What was synced last time; stored per device. Keys are paths in Unicode NFC. */
export interface SyncState {
	/** Which Nextcloud folder the state belongs to; a different one starts from scratch. */
	remote: string;
	files: Record<string, SyncedFile>;
	folders: string[];
	remoteCache: Record<string, FolderCache>;
}

export interface SyncResult {
	uploaded: number;
	downloaded: number;
	deleted: number;
	/** Conflict copies that were created. */
	conflicts: string[];
	errors: { path: string; message: string }[];
	/** Set when the sync stopped because it would delete this many files. */
	blocked?: number;
}

export interface SyncOptions {
	/** Device name used in conflict copies. */
	device: string;
	/** Let a sync delete many files at once (after the user confirmed it). */
	allowMassDeletion?: boolean;
	ignored(path: string): boolean;
	/** Files where a conflict keeps only the newer version instead of both (config files). */
	keepNewer(path: string): boolean;
	/** Saves the state now and then during long runs, so an interrupted run loses little. */
	checkpoint?(state: SyncState): Promise<void>;
}

const CONCURRENCY = 4;

/**
 * One sync run: lists both sides, compares them with the state of the last run, and copies,
 * deletes or keeps both versions accordingly. Each finished file is recorded in the state, so a run
 * that is interrupted (or fails for some files) just continues next time.
 */
export class SyncEngine {
	constructor(private local: LocalVault, private remote: WebDavRemote, private remoteId: string) {}

	async run(state: SyncState | null, options: SyncOptions): Promise<{ result: SyncResult; state: SyncState }> {
		if (!state || state.remote !== this.remoteId) state = { remote: this.remoteId, files: {}, folders: [], remoteCache: {} };
		const result: SyncResult = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: [], errors: [] };
		const ignored = options.ignored;

		let remoteListing = await this.remote.list(state.remoteCache, ignored);
		if (!remoteListing) {
			if (Object.keys(state.files).length) throw new Error("Der Nextcloud-Ordner wurde nicht gefunden. Wurde er umbenannt oder gelöscht?");
			await this.remote.createRoot();
			remoteListing = { files: [], folders: [] };
		}
		const localListing = await this.local.list(ignored);

		// Keys are NFC, so the same name written in different Unicode forms (macOS vs. others) matches.
		const local = new Map<string, LocalFile & { path: string }>();
		for (const f of localListing.files) local.set(nfc(f.path), f);
		const remote = new Map<string, RemoteFile & { path: string }>();
		for (const f of remoteListing.files) if (!ignored(f.path)) remote.set(nfc(f.path), f);
		const synced = new Map(Object.entries(state.files));

		const actions = planSync(local, remote, synced);
		if (!options.allowMassDeletion && isMassDeletion(actions, synced.size)) {
			result.blocked = countDeletions(actions);
			return { result, state };
		}

		const localFolders = new Map(localListing.folders.map((f) => [nfc(f), f]));
		const remoteFolders = new Map(remoteListing.folders.filter((f) => !ignored(f)).map((f) => [nfc(f), f]));
		const filesAfter = { local: new Set(local.keys()), remote: new Set(remote.keys()) };
		for (const a of actions) {
			if (a.type === "deleteLocal") filesAfter.local.delete(a.path);
			if (a.type === "deleteRemote") filesAfter.remote.delete(a.path);
			if (a.type === "download") filesAfter.local.add(a.path);
			if (a.type === "upload") filesAfter.remote.add(a.path);
		}
		const folders = planFolders(new Set(localFolders.keys()), new Set(remoteFolders.keys()), new Set(state.folders), filesAfter);

		const fail = (path: string, e: unknown) => result.errors.push({ path, message: describe(e) });
		const syncedFolders = new Set([...localFolders.keys()].filter((f) => remoteFolders.has(f)));

		for (const f of folders.mkdirLocal) {
			try {
				await this.local.mkdir(remoteFolders.get(f) ?? f);
				syncedFolders.add(f);
			} catch (e) {
				fail(f, e);
			}
		}
		for (const f of folders.mkdirRemote) {
			try {
				await this.remote.mkdir(localFolders.get(f) ?? f);
				syncedFolders.add(f);
			} catch (e) {
				fail(f, e);
			}
		}

		const taken = new Set([...local.keys(), ...remote.keys()]);
		const ctx: RunContext = { local, remote, state, result, taken, options };
		let done = 0;
		await pool(actions, CONCURRENCY, async (action) => {
			try {
				await this.execute(action, ctx);
			} catch (e) {
				// Changed meanwhile on the server: next sync takes care of it.
				if (status(e) !== 412) fail(action.path, e);
			}
			if (++done % 50 === 0) await options.checkpoint?.(state);
		});

		// Folders that couldn't be removed stay recorded, so the next sync tries again instead of re-creating them.
		for (const f of folders.rmdirLocal) {
			try {
				if (!(await this.local.trashFolderIfEmpty(localFolders.get(f) ?? f, ignored))) syncedFolders.add(f);
			} catch (e) {
				fail(f, e);
				syncedFolders.add(f);
			}
		}
		for (const f of folders.rmdirRemote) {
			try {
				if (!(await this.remote.deleteFolderIfEmpty(remoteFolders.get(f) ?? f, ignored))) syncedFolders.add(f);
			} catch (e) {
				fail(f, e);
				syncedFolders.add(f);
			}
		}
		state.folders = [...syncedFolders].sort();
		return { result, state };
	}

	private async execute(action: Action, ctx: RunContext): Promise<void> {
		const { local, remote, state, result } = ctx;
		const key = action.path;
		const l = local.get(key);
		const r = remote.get(key);
		const localPath = l?.path ?? r?.path ?? key;
		const remotePath = r?.path ?? l?.path ?? key;

		switch (action.type) {
			case "upload": {
				const stat = await this.local.stat(localPath);
				if (!stat) return; // deleted meanwhile
				const data = await this.local.read(localPath);
				const etag = await this.remote.put(remotePath, data, stat.mtime, action.ifMatch);
				state.files[key] = { localMtime: stat.mtime, localSize: stat.size, remoteEtag: etag };
				result.uploaded++;
				return;
			}
			case "download": {
				const { data, etag } = await this.remote.get(remotePath);
				// Checked right before writing, so edits made during the download aren't overwritten.
				if (!(await this.unchangedLocally(localPath, l))) return;
				await this.local.write(localPath, data, r!.mtime);
				await this.record(key, localPath, etag, state);
				result.downloaded++;
				return;
			}
			case "deleteLocal": {
				if (!(await this.unchangedLocally(localPath, l))) return;
				await this.local.trash(localPath);
				delete state.files[key];
				result.deleted++;
				return;
			}
			case "deleteRemote": {
				await this.remote.delete(remotePath, action.ifMatch);
				delete state.files[key];
				result.deleted++;
				return;
			}
			case "forget":
				delete state.files[key];
				return;
			case "compare":
			case "conflict": {
				// Same size and (almost) the same modification time: very likely already in sync.
				if (action.type === "compare" && l!.size === r!.size && Math.abs(l!.mtime - r!.mtime) < 2000) {
					state.files[key] = { localMtime: l!.mtime, localSize: l!.size, remoteEtag: r!.etag };
					return;
				}
				const stat = await this.local.stat(localPath);
				if (!stat) return;
				const mine = await this.local.read(localPath);
				const theirs = await this.remote.get(remotePath);
				if (!(await this.unchangedLocally(localPath, stat))) return; // edited meanwhile: next sync
				if (equal(mine, theirs.data)) {
					state.files[key] = { localMtime: stat.mtime, localSize: stat.size, remoteEtag: theirs.etag };
					return;
				}
				if (ctx.options.keepNewer(key)) {
					if (stat.mtime > r!.mtime) {
						const etag = await this.remote.put(remotePath, mine, stat.mtime, r!.etag);
						state.files[key] = { localMtime: stat.mtime, localSize: stat.size, remoteEtag: etag };
						result.uploaded++;
					} else {
						await this.local.write(localPath, theirs.data, r!.mtime);
						await this.record(key, localPath, theirs.etag, state);
						result.downloaded++;
					}
					return;
				}
				// Keep both: the local version moves to a conflict copy, the server's takes the original name.
				const copy = conflictPath(localPath, ctx.options.device, new Date(), (p) => ctx.taken.has(nfc(p)));
				ctx.taken.add(nfc(copy));
				await this.local.write(copy, mine, stat.mtime);
				await this.local.write(localPath, theirs.data, r!.mtime);
				await this.record(key, localPath, theirs.etag, state);
				const copyEtag = await this.remote.put(copy, mine, stat.mtime);
				await this.record(nfc(copy), copy, copyEtag, state);
				result.downloaded++;
				result.uploaded++;
				result.conflicts.push(copy);
				return;
			}
		}
	}

	/** Whether the local file still is as listed (or still absent), i.e. the user didn't change it during the sync. */
	private async unchangedLocally(path: string, listed: LocalFile | undefined): Promise<boolean> {
		const stat = await this.local.stat(path);
		if (!listed) return !stat;
		return !!stat && stat.mtime === listed.mtime && stat.size === listed.size;
	}

	private async record(key: string, localPath: string, etag: string, state: SyncState): Promise<void> {
		const stat = await this.local.stat(localPath);
		if (stat) state.files[key] = { localMtime: stat.mtime, localSize: stat.size, remoteEtag: etag };
	}
}

interface RunContext {
	local: Map<string, LocalFile & { path: string }>;
	remote: Map<string, RemoteFile & { path: string }>;
	state: SyncState;
	result: SyncResult;
	/** Paths in use on either side, so conflict copies get unique names. */
	taken: Set<string>;
	options: SyncOptions;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await work(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

function equal(a: ArrayBuffer, b: ArrayBuffer): boolean {
	if (a.byteLength !== b.byteLength) return false;
	const x = new Uint8Array(a);
	const y = new Uint8Array(b);
	for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
	return true;
}

function nfc(path: string): string {
	return path.normalize("NFC");
}

function describe(e: unknown): string {
	const code = status(e);
	if (code) return `HTTP ${code}`;
	return e instanceof Error ? e.message : String(e);
}
