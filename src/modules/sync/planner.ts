/** A file in the vault, as listed before a sync. */
export interface LocalFile {
	mtime: number;
	size: number;
}

/** A file in the Nextcloud folder, as listed before a sync. */
export interface RemoteFile {
	etag: string;
	mtime: number;
	size: number;
}

/** How a file looked on both sides after it was last synced. */
export interface SyncedFile {
	localMtime: number;
	localSize: number;
	remoteEtag: string;
}

export type Action =
	| { type: "upload"; path: string; ifMatch?: string }
	| { type: "download"; path: string }
	| { type: "deleteLocal"; path: string }
	| { type: "deleteRemote"; path: string; ifMatch: string }
	/** Exists on both sides but was never synced: equal content just gets recorded, different content is a conflict. */
	| { type: "compare"; path: string }
	/** Changed on both sides: keep both versions. */
	| { type: "conflict"; path: string }
	/** Gone on both sides: forget it. */
	| { type: "forget"; path: string };

/**
 * Decides per file what to do, by comparing both sides with the state of the last sync:
 * a side "changed" when its file differs from the recorded state (local mtime/size, remote ETag).
 * Deletions are only passed on for files the other side did not change since the last sync.
 */
export function planSync(local: Map<string, LocalFile>, remote: Map<string, RemoteFile>, state: Map<string, SyncedFile>): Action[] {
	const actions: Action[] = [];
	const paths = new Set([...local.keys(), ...remote.keys(), ...state.keys()]);
	for (const path of [...paths].sort()) {
		const l = local.get(path);
		const r = remote.get(path);
		const s = state.get(path);
		const localChanged = !!l && (!s || l.mtime !== s.localMtime || l.size !== s.localSize);
		const remoteChanged = !!r && (!s || r.etag !== s.remoteEtag);

		if (l && r) {
			if (!s) actions.push({ type: "compare", path });
			else if (localChanged && remoteChanged) actions.push({ type: "conflict", path });
			else if (localChanged) actions.push({ type: "upload", path, ifMatch: r.etag });
			else if (remoteChanged) actions.push({ type: "download", path });
		} else if (l) {
			// Remote deleted (or never there): delete locally only if unchanged since the last sync.
			if (s && !localChanged) actions.push({ type: "deleteLocal", path });
			else actions.push({ type: "upload", path });
		} else if (r) {
			if (s && !remoteChanged) actions.push({ type: "deleteRemote", path, ifMatch: r.etag });
			else actions.push({ type: "download", path });
		} else if (s) {
			actions.push({ type: "forget", path });
		}
	}
	return actions;
}

/**
 * Folders: new ones are created on the other side; a folder deleted on one side is deleted on the
 * other only if it is (or will be) empty there, otherwise it is re-created. Deepest first for deletions.
 */
export function planFolders(
	local: Set<string>,
	remote: Set<string>,
	synced: Set<string>,
	/** Files that will exist on each side after the file actions. */
	filesAfter: { local: Set<string>; remote: Set<string> }
): { mkdirLocal: string[]; mkdirRemote: string[]; rmdirLocal: string[]; rmdirRemote: string[] } {
	const result = { mkdirLocal: [] as string[], mkdirRemote: [] as string[], rmdirLocal: [] as string[], rmdirRemote: [] as string[] };
	const hasContent = (folder: string, files: Set<string>) => [...files].some((f) => f.startsWith(folder + "/"));

	for (const folder of [...new Set([...local, ...remote, ...synced])].sort()) {
		const l = local.has(folder);
		const r = remote.has(folder);
		if (l && !r) {
			if (synced.has(folder) && !hasContent(folder, filesAfter.local)) result.rmdirLocal.push(folder);
			else result.mkdirRemote.push(folder);
		} else if (r && !l) {
			if (synced.has(folder) && !hasContent(folder, filesAfter.remote)) result.rmdirRemote.push(folder);
			else result.mkdirLocal.push(folder);
		}
	}
	// A deleted folder that gets a new subfolder from the other side is re-created instead.
	const keep = (rmdir: string[], mkdirOther: string[]) =>
		rmdir.filter((f) => {
			const recreate = mkdirOther.some((m) => m.startsWith(f + "/"));
			if (recreate) mkdirOther.push(f);
			return !recreate;
		});
	result.rmdirLocal = keep(result.rmdirLocal, result.mkdirRemote);
	result.rmdirRemote = keep(result.rmdirRemote, result.mkdirLocal);
	// Create parents before children, delete children before parents.
	const depth = (f: string) => f.split("/").length;
	result.mkdirLocal.sort((a, b) => depth(a) - depth(b));
	result.mkdirRemote.sort((a, b) => depth(a) - depth(b));
	result.rmdirLocal.sort((a, b) => depth(b) - depth(a));
	result.rmdirRemote.sort((a, b) => depth(b) - depth(a));
	return result;
}

/** Number of deletions a plan would do; used to stop automatic syncs that would delete a lot at once. */
export function countDeletions(actions: Action[]): number {
	return actions.filter((a) => a.type === "deleteLocal" || a.type === "deleteRemote").length;
}

/** Whether a plan deletes suspiciously much (e.g. after picking a wrong or empty folder). */
export function isMassDeletion(actions: Action[], knownFiles: number): boolean {
	const deletions = countDeletions(actions);
	return deletions > 10 && deletions > knownFiles * 0.25;
}

/** "Notizen/Idee.md" → "Notizen/Idee (Konflikt iPhone 2026-10-15 1430).md" */
export function conflictPath(path: string, device: string, date: Date, exists: (path: string) => boolean): string {
	const slash = path.lastIndexOf("/");
	const dot = path.lastIndexOf(".");
	const hasExt = dot > slash + 1;
	const base = hasExt ? path.slice(0, dot) : path;
	const ext = hasExt ? path.slice(dot) : "";
	const pad = (n: number) => String(n).padStart(2, "0");
	const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
	let candidate = `${base} (Konflikt ${device} ${stamp})${ext}`;
	for (let i = 2; exists(candidate); i++) candidate = `${base} (Konflikt ${device} ${stamp} ${i})${ext}`;
	return candidate;
}
