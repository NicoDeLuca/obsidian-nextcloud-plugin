export interface NextcloudSettings {
	baseUrl: string;
	username: string;
	appPassword: string;
}

export const DEFAULT_SETTINGS: NextcloudSettings = {
	baseUrl: "",
	username: "",
	appPassword: "",
};
