import { useState, useCallback } from 'react';
import { STATS } from '../../shared/config/config.ts';
import {
	getAge,
	getAggressionScore,
	getCatId,
	getCatStat,
	getLibidoScore,
} from '../../shared/utils/catDataUtils.ts';
import type { CatRecord } from '../../AppLogic.types.ts';
import type {
	CatTableLogicParams,
	CatTableLogicResult,
	SortColumn,
	StatFilters,
} from './CatTable.types.ts';

function toComparableNumber(value: unknown): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function toComparableString(value: unknown): string {
	if (value === null || value === undefined) return '';
	return String(value);
}

function isCoreStat(value: string): boolean {
	return (STATS as readonly string[]).includes(value);
}

export function CatTableLogic({ cats, activeRoom }: CatTableLogicParams): CatTableLogicResult {
	const [sortCol, setSortCol] = useState<SortColumn>(null);
	const [sortAsc, setSortAsc] = useState(true);
	const [hoveredCatId, setHoveredCatId] = useState<string | number | null>(null);
	const [statFilters, setStatFilters] = useState<StatFilters>({});

	const setStatFilter = useCallback((statKey: string, value: number | null) => {
		setStatFilters((prev) => {
			if (value === null || value === undefined) {
				const { [statKey]: _removed, ...rest } = prev;
				return rest;
			}
			return { ...prev, [statKey]: value };
		});
	}, []);

	const clearStatFilters = useCallback(() => setStatFilters({}), []);

	const handleSort = useCallback(
		(column: string) => {
			if (sortCol !== column) {
				setSortCol(column);
				setSortAsc(true);
			} else if (sortAsc) {
				setSortAsc(false);
			} else {
				setSortCol(null);
				setSortAsc(true);
			}
		},
		[sortCol, sortAsc]
	);

	const totalStat = (cat: CatRecord) =>
		STATS.reduce((sum, statKey) => sum + getCatStat(cat, statKey), 0);

	const roomCats = cats.filter((cat) => cat.room === activeRoom);
	const activeFilters = Object.entries(statFilters);

	const filtered =
		activeFilters.length > 0
			? roomCats.filter((cat) =>
					activeFilters.every(([key, value]) => getCatStat(cat, key) === value)
				)
			: roomCats;

	const sorted = [...filtered].sort((a, b) => {
		if (!sortCol) return 0;

		if (sortCol === 'total') {
			return sortAsc ? totalStat(a) - totalStat(b) : totalStat(b) - totalStat(a);
		}

		if (sortCol === 'age') {
			const ageA = getAge(a) ?? -1;
			const ageB = getAge(b) ?? -1;
			return sortAsc ? ageA - ageB : ageB - ageA;
		}

		if (isCoreStat(sortCol)) {
			const statA = getCatStat(a, sortCol);
			const statB = getCatStat(b, sortCol);
			return sortAsc ? statA - statB : statB - statA;
		}

		if (sortCol === 'id') {
			const idA = getCatId(a);
			const idB = getCatId(b);
			return sortAsc ? idA.localeCompare(idB) : idB.localeCompare(idA);
		}

		if (sortCol === 'aggression') {
			const aggressionA = getAggressionScore(a) ?? -1;
			const aggressionB = getAggressionScore(b) ?? -1;
			return sortAsc ? aggressionA - aggressionB : aggressionB - aggressionA;
		}

		if (sortCol === 'libido') {
			const libidoA = getLibidoScore(a) ?? -1;
			const libidoB = getLibidoScore(b) ?? -1;
			return sortAsc ? libidoA - libidoB : libidoB - libidoA;
		}

		const valueA = (a as Record<string, unknown>)[sortCol];
		const valueB = (b as Record<string, unknown>)[sortCol];

		if (typeof valueA === 'string' || typeof valueB === 'string') {
			const stringA = toComparableString(valueA);
			const stringB = toComparableString(valueB);
			return sortAsc ? stringA.localeCompare(stringB) : stringB.localeCompare(stringA);
		}

		const numberA = toComparableNumber(valueA);
		const numberB = toComparableNumber(valueB);
		return sortAsc ? numberA - numberB : numberB - numberA;
	});

	const aggroColor = (value: number) =>
		value <= 3
			? 'var(--color-positive-soft)'
			: value <= 6
				? 'var(--color-text-neutral)'
				: 'var(--color-negative)';

	return {
		hoveredCatId,
		setHoveredCatId,
		handleSort,
		sorted,
		aggroColor,
		totalStat,
		sortCol,
		sortAsc,
		statFilters,
		setStatFilter,
		clearStatFilters,
	};
}
