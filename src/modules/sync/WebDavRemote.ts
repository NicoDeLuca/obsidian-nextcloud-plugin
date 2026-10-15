import { RequestUrlResponse } from "obsidian";
import { NextcloudClient } from "../../core/NextcloudClient";

/** A file in the Nextcloud folder; `path` is its real path relative to the sync folder. */
export interface RemoteEntry {
	path: string;
	etag: string;
	mtime: number;
	size: number;
}

/**
 * Listing of one remote folder, kept between syncs: Nextcloud changes a folder's ETag whenever
 * anything below it changes, so folders with an unchanged ETag don't need to be listed again.
 */
export interface FolderCache {
	etag: string;
	files: Record<string, { etag: string; mtime: number; size: number }>;
	folders: Record<string, string>;
}

const DAV = "DAV:";
const PROPFIND = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
	<d:prop>
		<d:getetag/>
		<d:getlastmodified/>
		<d:getcontentlength/>
		<d:resourcetype/>
	</d:prop>
</d:propfind>`;

/** WebDAV access to the sync folder in the user's Nextcloud files. Paths are relative to that folder. */
export class WebDavRemote {
	/** @param root the folder's WebDAV path, e.g. /remote.php/dav/files/nico/Obsidian */
	constructor(private client: NextcloudClient, private root: string) {}

	/**
	 * All files and folders below the sync folder, or null if the folder doesn't exist.
	 * `cache` is the result of the previous listing; it is replaced with the current one.
	 * @param skip folders not to descend into (ignored ones)
	 */
	async list(cache: Record<string, FolderCache>, skip: (path: string) => boolean): Promise<{ files: RemoteEntry[]; folders: string[] } | null> {
		const files: RemoteEntry[] = [];
		const folders: string[] = [];
		const next: Record<string, FolderCache> = {};

		const walk = async (folder: string, etag?: string) => {
			let listing = etag !== undefined && cache[folder]?.etag === etag ? cache[folder] : undefined;
			if (!listing) listing = await this.propfind(folder);
			next[folder] = listing;
			for (const [name, file] of Object.entries(listing.files)) files.push({ path: join(folder, name), ...file });
			for (const [name, childEtag] of Object.entries(listing.folders)) {
				const child = join(folder, name);
				if (skip(child)) continue;
				folders.push(child);
				await walk(child, childEtag);
			}
		};

		try {
			await walk("");
		} catch (e) {
			if (status(e) === 404) return null;
			throw e;
		}
		for (const key of Object.keys(cache)) delete cache[key];
		Object.assign(cache, next);
		return { files, folders };
	}

	/** The file's content and the ETag of exactly this version. */
	async get(path: string): Promise<{ data: ArrayBuffer; etag: string }> {
		const res = await this.client.request("GET", this.url(path), { headers: { Accept: "*/*" } });
		return { data: res.arrayBuffer, etag: unquote(header(res, "etag") || header(res, "oc-etag")) || (await this.etag(path)) };
	}

	/**
	 * Uploads a file and keeps its modification time. With `ifMatch` it only overwrites that
	 * version, without it only creates a new file; otherwise it fails with HTTP 412. Returns the new ETag.
	 */
	async put(path: string, data: ArrayBuffer, mtime: number, ifMatch?: string): Promise<string> {
		const send = () =>
			this.client.request("PUT", this.url(path), {
				body: data,
				contentType: "application/octet-stream",
				headers: {
					"X-OC-MTime": String(Math.floor(mtime / 1000)),
					...(ifMatch ? { "If-Match": `"${ifMatch}"` } : { "If-None-Match": "*" }),
				},
			});
		let res: RequestUrlResponse;
		try {
			res = await send();
		} catch (e) {
			if (status(e) !== 409 && status(e) !== 404) throw e;
			// The parent folder is missing.
			await this.mkdir(parent(path));
			res = await send();
		}
		return unquote(header(res, "oc-etag") || header(res, "etag")) || (await this.etag(path));
	}

	/** Creates the sync folder itself, and its parents in the user's files. */
	async createRoot(): Promise<void> {
		const segments = this.root.split("/"); // "", remote.php, dav, files, user, folder…
		for (let i = 6; i <= segments.length; i++) {
			try {
				await this.client.request("MKCOL", segments.slice(0, i).join("/"));
			} catch (e) {
				if (status(e) !== 405) throw e; // 405: exists already
			}
		}
	}

	/** Creates the folder and any missing parents. */
	async mkdir(path: string): Promise<void> {
		try {
			await this.client.request("MKCOL", this.url(path));
		} catch (e) {
			if (status(e) === 405) return; // already exists
			if (status(e) !== 409 || !path) throw e; // 409: parent missing
			await this.mkdir(parent(path));
			await this.client.request("MKCOL", this.url(path));
		}
	}

	/** Deletes a file (only that version, with `ifMatch`). Nextcloud keeps it in its trash bin. */
	async delete(path: string, ifMatch?: string): Promise<void> {
		try {
			await this.client.request("DELETE", this.url(path), { headers: ifMatch ? { "If-Match": `"${ifMatch}"` } : {} });
		} catch (e) {
			if (status(e) !== 404) throw e;
		}
	}

	/** Deletes a folder, but only if it holds nothing except the given ignored names. */
	async deleteFolderIfEmpty(path: string, ignored: (path: string) => boolean): Promise<boolean> {
		let listing: FolderCache;
		try {
			listing = await this.propfind(path);
		} catch (e) {
			if (status(e) === 404) return true;
			throw e;
		}
		const children = [...Object.keys(listing.files), ...Object.keys(listing.folders)];
		if (children.some((name) => !ignored(join(path, name)))) return false;
		await this.delete(path);
		return true;
	}

	private async etag(path: string): Promise<string> {
		const res = await this.client.request("PROPFIND", this.url(path), {
			headers: { Depth: "0", Accept: "application/xml" },
			contentType: "application/xml; charset=utf-8",
			body: PROPFIND,
		});
		const doc = new DOMParser().parseFromString(res.text, "application/xml");
		return unquote(text(doc.documentElement, "getetag"));
	}

	/** Lists one folder (Depth 1). */
	private async propfind(folder: string): Promise<FolderCache> {
		const res = await this.client.request("PROPFIND", this.url(folder) + "/", {
			headers: { Depth: "1", Accept: "application/xml" },
			contentType: "application/xml; charset=utf-8",
			body: PROPFIND,
		});
		const self = normalizeHref(this.root + (folder ? "/" + folder : ""));
		const listing: FolderCache = { etag: "", files: {}, folders: {} };
		const doc = new DOMParser().parseFromString(res.text, "application/xml");
		for (const response of Array.from(doc.getElementsByTagNameNS(DAV, "response"))) {
			const href = this.client.hrefToPath(text(response, "href")).replace(/\/+$/, "");
			const prop = okProp(response);
			if (!prop) continue;
			const etag = unquote(text(prop, "getetag"));
			if (normalizeHref(href) === self) {
				listing.etag = etag;
				continue;
			}
			const name = decodeURIComponent(href.slice(href.lastIndexOf("/") + 1));
			if (prop.getElementsByTagNameNS(DAV, "collection").length) {
				listing.folders[name] = etag;
			} else {
				listing.files[name] = {
					etag,
					mtime: Date.parse(text(prop, "getlastmodified")) || 0,
					size: Number(text(prop, "getcontentlength")) || 0,
				};
			}
		}
		return listing;
	}

	private url(path: string): string {
		return this.root + (path ? "/" + path.split("/").map(encodeURIComponent).join("/") : "");
	}
}

/** The WebDAV path of a folder in the user's files, e.g. "Obsidian/Notizen" → /remote.php/dav/files/nico/Obsidian/Notizen */
export function davRoot(userId: string, folder: string): string {
	const segments = folder.split("/").filter((s) => s.trim());
	return ["/remote.php/dav/files", encodeURIComponent(userId), ...segments.map(encodeURIComponent)].join("/");
}

function join(folder: string, name: string): string {
	return folder ? `${folder}/${name}` : name;
}

function parent(path: string): string {
	return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** Servers encode hrefs differently (case of %xx, which characters), so compare the encoded form of the decoded path. */
function normalizeHref(href: string): string {
	return href
		.replace(/\/+$/, "")
		.split("/")
		.map((s) => encodeURIComponent(decodeURIComponent(s).normalize("NFC")))
		.join("/");
}

function okProp(response: Element): Element | null {
	for (const propstat of Array.from(response.getElementsByTagNameNS(DAV, "propstat"))) {
		if (/\s200\s/.test(text(propstat, "status"))) return propstat.getElementsByTagNameNS(DAV, "prop")[0] ?? null;
	}
	return null;
}

function text(el: Element, name: string): string {
	return el.getElementsByTagNameNS(DAV, name)[0]?.textContent?.trim() ?? "";
}

function header(res: RequestUrlResponse, name: string): string {
	const key = Object.keys(res.headers ?? {}).find((k) => k.toLowerCase() === name);
	return key ? res.headers[key] : "";
}

function unquote(etag: string): string {
	return etag.replace(/^W\//, "").replace(/^"|"$/g, "");
}

export function status(e: unknown): number | undefined {
	return e && typeof e === "object" && "status" in e ? (e as { status: number }).status : undefined;
}
