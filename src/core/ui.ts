import { App, Modal, Setting } from "obsidian";

/** Asks a yes/no question; resolves to true when confirmed. */
export function confirmModal(app: App, title: string, message: string, confirmText: string): Promise<boolean> {
	return new Promise((resolve) => {
		let confirmed = false;
		const modal = new Modal(app);
		modal.titleEl.setText(title);
		modal.contentEl.createEl("p", { text: message });
		new Setting(modal.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
			.addButton((b) =>
				b
					.setButtonText(confirmText)
					.setWarning()
					.onClick(() => {
						confirmed = true;
						modal.close();
					})
			);
		modal.onClose = () => resolve(confirmed);
		modal.open();
	});
}
