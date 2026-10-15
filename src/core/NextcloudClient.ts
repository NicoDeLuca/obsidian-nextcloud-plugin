import { requestUrl, RequestUrlResponse } from "obsidian";
import { NextcloudSettings } from "./types";

/**
 * The only place that talks to Nextcloud. Uses Obsidian's requestUrl so it
 * works identically on desktop and mobile and is not subject to CORS.
 */
export class NextcloudClient {
	constructor(private getSettings: () => NextcloudSettings) {}

	get isConfigured(): boolean {
		const { baseUrl, username, appPassword } = this.getSettings();
		return !!(baseUrl && username && appPassword);
	}

	/** The Nextcloud base URL without trailing slash. */
	get baseUrl(): string {
		return this.getSettings().baseUrl.replace(/\/+$/, "");
	}

	/** GET a path relative to the Nextcloud base URL. Throws on HTTP >= 400. */
	get(path: string): Promise<RequestUrlResponse> {
		return this.request("GET", path);
	}

	/** PUT a JSON body to a path relative to the Nextcloud base URL. */
	put(path: string, body: unknown): Promise<RequestUrlResponse> {
		return this.request("PUT", path, { body: JSON.stringify(body), contentType: "application/json" });
	}

	/** POST a JSON body to a path relative to the Nextcloud base URL. */
	post(path: string, body: unknown): Promise<RequestUrlResponse> {
		return this.request("POST", path, { body: JSON.stringify(body), contentType: "application/json" });
	}

	/** Checks the credentials and returns the user's display name. */
	async testConnection(): Promise<string> {
		const user = await this.getCurrentUser();
		return user.displayName || user.id;
	}

	/** The logged-in user. The id can differ from the login name (e.g. when logging in with an email address). */
	async getCurrentUser(): Promise<{ id: string; displayName: string }> {
		const res = await this.get("/ocs/v2.php/cloud/user?format=json");
		return { id: res.json.ocs.data.id, displayName: res.json.ocs.data.displayname };
	}

	/**
	 * Any request to a path relative to the Nextcloud base URL, e.g. WebDAV/CalDAV
	 * methods like PROPFIND or REPORT. Throws on HTTP >= 400 (unless `throw: false`).
	 */
	async request(method: string, path: string, options: RequestOptions = {}): Promise<RequestUrlResponse> {
		if (!this.isConfigured) {
			throw new Error("Die Nextcloud-Verbindung ist noch nicht eingerichtet (Einstellungen → Nextcloud).");
		}
		const { baseUrl, username, appPassword } = this.getSettings();
		const headers: Record<string, string> = {
			Authorization: "Basic " + base64(`${username}:${appPassword}`),
			Accept: "application/json",
			"OCS-APIRequest": "true",
			...options.headers,
		};
		if (options.contentType) headers["Content-Type"] = options.contentType;
		return requestUrl({
			url: baseUrl.replace(/\/+$/, "") + path,
			method,
			headers,
			body: options.body,
			throw: options.throw,
		});
	}

	/** Turns an absolute href from a WebDAV response into a path for request(). */
	hrefToPath(href: string): string {
		const basePath = new URL(this.getSettings().baseUrl).pathname.replace(/\/+$/, "");
		return basePath && href.startsWith(basePath + "/") ? href.slice(basePath.length) : href;
	}
}

export interface RequestOptions {
	body?: string | ArrayBuffer;
	contentType?: string;
	/** Extra headers; these override the defaults (e.g. Accept). */
	headers?: Record<string, string>;
	/** false: return responses with HTTP >= 400 instead of throwing, e.g. to read an error message from the body. */
	throw?: boolean;
}

/** Short, user-facing description of a failed request. */
export function errorMessage(e: unknown): string {
	if (e && typeof e === "object" && "status" in e) return `HTTP ${(e as { status: number }).status}`;
	return e instanceof Error ? e.message : String(e);
}

// btoa only handles Latin-1, so encode as UTF-8 first (usernames may contain umlauts).
function base64(s: string): string {
	let bin = "";
	new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)));
	return btoa(bin);
}
