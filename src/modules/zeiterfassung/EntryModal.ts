import { App, ButtonComponent, moment, Modal, Notice, Setting } from "obsidian";
import { hm, messageOf, ZeiterfassungApi } from "./ZeiterfassungApi";

/** Adds a past working period ("Eintrag nachtragen"). */
export class EntryModal extends Modal {
	constructor(app: App, private api: ZeiterfassungApi, private onSaved: () => void) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText("Eintrag nachtragen");

		const input = (name: string, type: string, value: string, desc?: string) => {
			const setting = new Setting(contentEl).setName(name);
			if (desc) setting.setDesc(desc);
			return setting.controlEl.createEl("input", { type, value });
		};
		const date = input("Datum", "date", moment().format("YYYY-MM-DD"));
		const start = input("Beginn", "time", "");
		const end = input("Ende", "time", "", "Liegt das Ende vor dem Beginn, zählt es als Uhrzeit am Folgetag.");
		const pause = input("Pause (Minuten)", "number", "0");
		pause.min = "0";
		pause.step = "1";

		let saveButton: ButtonComponent;
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()))
			.addButton((b) => {
				saveButton = b;
				b.setButtonText("Eintragen")
					.setCta()
					.onClick(async () => {
						const pauseMinutes = Number(pause.value || "0");
						if (!date.value || !start.value || !end.value) {
							new Notice("Bitte Datum, Beginn und Ende angeben.");
							return;
						}
						if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0) {
							new Notice("Die Pause muss eine ganze Zahl von Minuten sein.");
							return;
						}
						saveButton.setDisabled(true);
						try {
							const entry = await this.api.createEntry({ date: date.value, start: start.value, end: end.value, pauseMinutes });
							const nextDay = entry.endDate !== entry.date ? " (Ende am Folgetag)" : "";
							const calendar = entry.inCalendar ? "" : "\nDer Kalendertermin fehlt – bitte in der Zeiterfassung prüfen.";
							new Notice(`Zeiterfassung: eingetragen am ${moment(entry.date).format("DD.MM.")}, ${entry.start}–${entry.end}${nextDay}, ${hm(entry.workSeconds)} h.${calendar}`, 8000);
							this.close();
							this.onSaved();
						} catch (e) {
							new Notice(`Zeiterfassung: ${messageOf(e)}`, 8000);
						} finally {
							saveButton.setDisabled(false);
						}
					});
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
