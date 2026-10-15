import { App, ButtonComponent, moment } from "obsidian";
import { BlockDefinition, BlockWidget, Options } from "../../core/blocks";
import { TimeTracker } from "./TimeTracker";
import { renderWeek } from "./WeekView";
import { TimerAction } from "./ZeiterfassungApi";

/**
 * ```nextcloud-zeiterfassung
 * anzeige: beides   # beides | timer | woche
 * ```
 */
export function timeBlock(tracker: TimeTracker): BlockDefinition {
	return {
		language: "nextcloud-zeiterfassung",
		title: "Zeiterfassung (Timer und Woche)",
		template: "anzeige: beides",
		keys: ["titel", "anzeige"],
		create: (el, options, host) => new TimeBlock(el, host.app, options, tracker),
	};
}

/** Timer with buttons and/or the current week. Uses the module's shared timer state, which reloads every minute. */
class TimeBlock extends BlockWidget {
	private show: "beides" | "timer" | "woche";

	constructor(el: HTMLElement, app: App, options: Options, private tracker: TimeTracker) {
		super(el, app, options, "Zeiterfassung", 0);
		this.show = options.choice("anzeige", ["beides", "timer", "woche"], "beides");
	}

	onload() {
		super.onload();
		this.register(this.tracker.onChange(() => this.refresh()));
		// The running time changes locally; minutes are enough.
		this.registerInterval(window.setInterval(() => this.refresh(), 15_000));
	}

	protected reload() {
		this.tracker.refresh(true);
	}

	protected async update(body: HTMLElement) {
		if (!this.tracker.state && !this.tracker.error) await this.tracker.refresh();
		if (this.show !== "woche") this.renderTimer(body);
		// With the timer shown above, the week leaves out its own timer line.
		if (this.show !== "timer") renderWeek(body.createDiv({ cls: "nc-time" }), this.tracker, this.show === "woche");
	}

	private renderTimer(body: HTMLElement) {
		const state = this.tracker.state;
		if (!state) {
			if (this.show === "timer") body.createEl("p", { cls: "nc-cookbook-status", text: this.tracker.error ? `Konnte nicht geladen werden: ${this.tracker.error}` : "Wird geladen …" });
			return;
		}
		const timer = state.timer;
		const row = body.createDiv({ cls: "nc-time-timer" });
		const clock = row.createDiv({ cls: "nc-time-clock" });
		const minutes = Math.floor(this.tracker.workSeconds() / 60);
		clock.createSpan({ cls: "nc-time-clock-value", text: timer ? `${timer.paused ? "⏸" : "⏱"} ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : "⏱ –" });
		clock.createSpan({
			cls: "nc-time-muted",
			text: !timer ? "Kein Timer aktiv" : timer.paused ? `pausiert seit ${moment.unix(timer.pausedSince!).format("HH:mm")}` : `läuft seit ${moment.unix(timer.startedAt).format("HH:mm")}`,
		});

		const buttons = row.createDiv({ cls: "nc-time-buttons" });
		const button = (label: string, action: TimerAction, cta = false) => {
			const b = new ButtonComponent(buttons).setButtonText(label).onClick(async () => {
				b.setDisabled(true);
				await this.tracker.run(action);
			});
			if (cta) b.setCta();
		};
		if (!timer) button("Start", "start", true);
		else if (timer.paused) button("Weiter", "resume", true);
		else button("Pause", "pause");
		if (timer) button("Stop", "stop");
	}
}
