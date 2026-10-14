export interface TimedItem<T> {
	item: T;
	/** Minutes since the start of the day. */
	start: number;
	end: number;
}

export interface PlacedItem<T> extends TimedItem<T> {
	/** Column within its group of overlapping items, and the number of columns in that group. */
	column: number;
	columns: number;
}

/** Very short items still take this much space, so they don't visually overlap. */
const MIN_MINUTES = 20;

/** Places overlapping items of one day side by side. */
export function layoutDay<T>(items: TimedItem<T>[]): PlacedItem<T>[] {
	const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
	const placed: PlacedItem<T>[] = [];
	let group: PlacedItem<T>[] = [];
	let columnEnds: number[] = [];
	let groupEnd = -Infinity;

	const closeGroup = () => {
		for (const p of group) p.columns = columnEnds.length;
		group = [];
		columnEnds = [];
	};

	for (const item of sorted) {
		const end = Math.max(item.end, item.start + MIN_MINUTES);
		if (item.start >= groupEnd) closeGroup();
		let column = columnEnds.findIndex((columnEnd) => columnEnd <= item.start);
		if (column === -1) column = columnEnds.push(end) - 1;
		else columnEnds[column] = end;
		const p = { ...item, column, columns: 0 };
		group.push(p);
		placed.push(p);
		groupEnd = Math.max(groupEnd, end);
	}
	closeGroup();
	return placed;
}
