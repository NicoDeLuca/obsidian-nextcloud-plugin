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

	/** GET a path relative to the Nextcloud base URL. Throws on HTTP >= 400. */
	get(path: string): Promise<RequestUrlResponse> {
		return this.request("GET", path);
	}

	/** PUT a JSON body to a path relative to the Nextcloud base URL. */
	put(path: string, body: unknown): Promise<RequestUrlResponse> {
		return this.request("PUT", path, JSON.stringify(body));
	}

	/** Checks the credentials and returns the user's display name. */
	async testConnection(): Promise<string> {
		const res = await this.get("/ocs/v2.php/cloud/user?format=json");
		return res.json.ocs.data.displayname || res.json.ocs.data.id;
	}

	private async request(method: string, path: string, body?: string): Promise<RequestUrlResponse> {
		if (!this.isConfigured) {
			throw new Error("Nextcloud connection is not configured.");
		}
		const { baseUrl, username, appPassword } = this.getSettings();
		const headers: Record<string, string> = {
			Authorization: "Basic " + base64(`${username}:${appPassword}`),
			Accept: "application/json",
			"OCS-APIRequest": "true",
		};
		if (body !== undefined) headers["Content-Type"] = "application/json";
		return requestUrl({
			url: baseUrl.replace(/\/+$/, "") + path,
			method,
			headers,
			body,
		});
	}
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
