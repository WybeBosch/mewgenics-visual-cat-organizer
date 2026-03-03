import { useState, useCallback } from 'react';
import { STATS } from '../../shared/config/config.jsx';
import { getAge, getCatId, getCatStat } from '../../shared/utils/catDataUtils.jsx';

export function CatTableLogic({ cats, activeRoom }) {
	// Table-specific state
	const [sortCol, setSortCol] = useState(null);
	const [sortAsc, setSortAsc] = useState(true);
	const [hoveredCatId, setHoveredCatId] = useState(null);
	const [statFilters, setStatFilters] = useState({});

	const setStatFilter = useCallback((statKey, value) => {
		setStatFilters((prev) => {
			if (value === null || value === undefined || value === '') {
				const { [statKey]: _, ...rest } = prev;
				return rest;
			}
			return { ...prev, [statKey]: value };
		});
	}, []);

	const clearStatFilters = useCallback(() => setStatFilters({}), []);

	const handleSort = useCallback(
		(col) => {
			if (sortCol !== col) {
				setSortCol(col);
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
	const totalStat = (cat) => STATS.reduce((sum, s) => sum + getCatStat(cat, s), 0);
	const roomCats = cats.filter((c) => c.room === activeRoom);
	const activeFilters = Object.entries(statFilters);
	const filtered =
		activeFilters.length > 0
			? roomCats.filter((cat) =>
					activeFilters.every(([key, val]) => getCatStat(cat, key) === val)
				)
			: roomCats;
	const sorted = [...filtered].sort((a, b) => {
		if (!sortCol) return 0;
		if (sortCol === 'total')
			return sortAsc ? totalStat(a) - totalStat(b) : totalStat(b) - totalStat(a);
		if (sortCol === 'age') {
			const av = getAge(a);
			const bv = getAge(b);
			return sortAsc ? av - bv : bv - av;
		}
		if (STATS.includes(sortCol)) {
			const av = getCatStat(a, sortCol);
			const bv = getCatStat(b, sortCol);
			return sortAsc ? av - bv : bv - av;
		}
		if (sortCol === 'id') {
			const av = getCatId(a);
			const bv = getCatId(b);
			return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
		}
		const av = a[sortCol],
			bv = b[sortCol];
		if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
		return sortAsc ? av - bv : bv - av;
	});

	const aggroColor = (v) =>
		v <= 3
			? 'var(--color-positive-soft)'
			: v <= 6
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
