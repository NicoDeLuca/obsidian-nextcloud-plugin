import { NextcloudClient } from "../../core/NextcloudClient";

const BASE = "/index.php/apps/deck/api/v1.0";

export interface DeckLabel {
	id: number;
	title: string;
	/** Hex without "#". */
	color: string;
}

export interface DeckBoard {
	id: number;
	title: string;
	color: string;
	canEdit: boolean;
	labels: DeckLabel[];
}

export interface DeckCard {
	id: number;
	stackId: number;
	title: string;
	description: string;
	order: number;
	duedate: Date | null;
	/** Undefined on Deck versions without the "done" feature. */
	done?: Date | null;
	labels: DeckLabel[];
	assignees: string[];
	lastModified: number;
	/** The card as Deck sent it; updates are built from it because Deck resets fields that are left out. */
	raw: RawCard;
}

export interface DeckStack {
	id: number;
	title: string;
	order: number;
	cards: DeckCard[];
}

type RawCard = Record<string, unknown> & { id: number; stackId: number; title: string };

/** What the card form edits. */
export interface CardChanges {
	title: string;
	description: string;
	duedate: Date | null;
	done?: boolean;
}

export class DeckApi {
	constructor(private client: NextcloudClient) {}

	async listBoards(): Promise<DeckBoard[]> {
		const boards = await this.json<Array<Record<string, any>>>("GET", "/boards");
		return boards.filter((b) => !b.archived && !b.deletedAt).map(toBoard);
	}

	/** Board details, including labels and the user's permissions. */
	async getBoard(boardId: number): Promise<DeckBoard> {
		return toBoard(await this.json("GET", `/boards/${boardId}`));
	}

	/** Stacks with their (non-archived) cards, both sorted. */
	async getStacks(boardId: number): Promise<DeckStack[]> {
		const stacks = await this.json<Array<Record<string, any>>>("GET", `/boards/${boardId}/stacks`);
		return stacks
			.map((s) => ({
				id: s.id,
				title: s.title,
				order: s.order,
				cards: ((s.cards ?? []) as RawCard[])
					.filter((c) => !c.archived && !c.deletedAt)
					.map(toCard)
					.sort((a, b) => a.order - b.order || a.id - b.id),
			}))
			.sort((a, b) => a.order - b.order || a.id - b.id);
	}

	async getCard(boardId: number, stackId: number, cardId: number): Promise<DeckCard> {
		return toCard(await this.json("GET", `/boards/${boardId}/stacks/${stackId}/cards/${cardId}`));
	}

	async createCard(boardId: number, stackId: number, title: string, order: number): Promise<void> {
		await this.json("POST", `/boards/${boardId}/stacks/${stackId}/cards`, { title, type: "plain", order });
	}

	/** Updates a card. Every field is sent, taken from `card` unless changed, since Deck resets missing ones. */
	async updateCard(boardId: number, card: DeckCard, changes: CardChanges): Promise<void> {
		const raw = card.raw;
		const body: Record<string, unknown> = {
			title: changes.title,
			description: changes.description,
			type: raw.type ?? "plain",
			owner: typeof raw.owner === "object" && raw.owner ? (raw.owner as { uid: string }).uid : raw.owner,
			order: raw.order ?? 0,
			duedate: changes.duedate ? changes.duedate.toISOString() : null,
			archived: raw.archived ?? false,
		};
		if ("startdate" in raw) body.startdate = raw.startdate ?? null;
		if ("done" in raw) {
			const wasDone = !!raw.done;
			body.done = changes.done === undefined || changes.done === wasDone ? raw.done ?? null : changes.done ? new Date().toISOString() : null;
		}
		await this.json("PUT", `/boards/${boardId}/stacks/${card.stackId}/cards/${card.id}`, body);
	}

	/** Moves a card to `order` (0-based position) in `stackId`. */
	async moveCard(boardId: number, card: DeckCard, stackId: number, order: number): Promise<void> {
		await this.json("PUT", `/boards/${boardId}/stacks/${card.stackId}/cards/${card.id}/reorder`, { stackId, order });
	}

	async setLabel(boardId: number, card: DeckCard, labelId: number, assigned: boolean): Promise<void> {
		const action = assigned ? "assignLabel" : "removeLabel";
		await this.json("PUT", `/boards/${boardId}/stacks/${card.stackId}/cards/${card.id}/${action}`, { labelId });
	}

	async archiveCard(boardId: number, card: DeckCard): Promise<void> {
		await this.json("PUT", `/boards/${boardId}/stacks/${card.stackId}/cards/${card.id}/archive`, {});
	}

	async deleteCard(boardId: number, card: DeckCard): Promise<void> {
		await this.json("DELETE", `/boards/${boardId}/stacks/${card.stackId}/cards/${card.id}`);
	}

	private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await this.client.request(method, BASE + path, {
			body: body === undefined ? undefined : JSON.stringify(body),
			contentType: "application/json",
		});
		return res.json as T;
	}
}

function toBoard(b: Record<string, any>): DeckBoard {
	return {
		id: b.id,
		title: b.title,
		color: b.color ? `#${b.color}` : "var(--interactive-accent)",
		canEdit: !!b.permissions?.PERMISSION_EDIT,
		labels: (b.labels ?? []).map(toLabel),
	};
}

function toLabel(l: Record<string, any>): DeckLabel {
	return { id: l.id, title: l.title, color: l.color };
}

function toCard(raw: RawCard): DeckCard {
	const r = raw as Record<string, any>;
	const card: DeckCard = {
		id: raw.id,
		stackId: raw.stackId,
		title: raw.title,
		description: r.description ?? "",
		order: r.order ?? 0,
		duedate: r.duedate ? new Date(r.duedate) : null,
		labels: (r.labels ?? []).map(toLabel),
		assignees: (r.assignedUsers ?? []).map((a: any) => a.participant?.displayname || a.participant?.uid).filter(Boolean),
		lastModified: r.lastModified ?? 0,
		raw,
	};
	if ("done" in raw) card.done = r.done ? new Date(r.done) : null;
	return card;
}
