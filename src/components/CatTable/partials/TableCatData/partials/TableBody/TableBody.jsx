import { useEffect, useRef } from 'react';
import { STATS, SEX_ICON, CAT_ICON } from '../../../../../../shared/config/config.jsx';
import { TableTooltipPopup, joinClass } from '../../../../../../shared/utils/utils.jsx';
import {
	getAge,
	getCatId,
	getCatSex,
	getCatStat,
} from '../../../../../../shared/utils/catDataUtils.jsx';
import './TableBody.css';

function NoCatsFoundWarning({ columnsLength }) {
	return (
		<tr>
			<td colSpan={columnsLength} className="no-cats-warning">
				No cats in this room.
			</td>
		</tr>
	);
}

export function TableBody({
	cats,
	columns,
	sorted,
	hoveredCatId,
	setHoveredCatId,
	totalStat,
	isPartnerInOtherRoom,
	highlightedCatId,
}) {
	const noCatsFound = sorted.length === 0;
	const highlightedRowRef = useRef(null);

	useEffect(() => {
		if (highlightedCatId && highlightedRowRef.current) {
			highlightedRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}, [highlightedCatId]);

	function getAggressionClass(aggression) {
		if (aggression <= 3) return 'low';
		if (aggression <= 6) return '';
		return 'high';
	}

	function getAgeClass(age) {
		if (age === null) return 'unknown';
		if (age <= 1) return 'kitten';
		return '';
	}

	function getStatClass(statValue) {
		if (statValue >= 7) return 'high';
		if (statValue <= 4) return 'low';
		return '';
	}

	return (
		<tbody className="table-body">
			{noCatsFound ? <NoCatsFoundWarning columnsLength={columns.length} /> : null}
			{sorted.map((cat, i) => {
				const catId = getCatId(cat, `${cat.name}-${i}`);
				const catSex = getCatSex(cat);
				const total = totalStat(cat);
				const age = getAge(cat);
				const isHovered = hoveredCatId === catId;
				const isHighlighted = highlightedCatId === catId;
				const partnerInOtherRoom = isPartnerInOtherRoom(cat);

				return (
					<tr
						key={catId + i}
						ref={isHighlighted ? highlightedRowRef : undefined}
						className={joinClass('row', {
							hovered: isHovered,
							'search-match': isHighlighted,
						})}
						onMouseEnter={() => setHoveredCatId(catId)}
						onMouseLeave={() => setHoveredCatId(null)}
					>
						<TableTooltipPopup cat={cat} allCats={cats} />
						<td className="cell partner-indicator">{partnerInOtherRoom ? '🕵️‍♂️' : ''}</td>
						<td
							className={joinClass('cell age', getAgeClass(age))}
							title={
								age !== null ? `${age} day${age === 1 ? '' : 's'} old` : 'Unknown'
							}
						>
							{age !== null ? age : '—'}
						</td>
						<td className={joinClass('cell sex', catSex || 'unknown')}>
							{SEX_ICON[catSex] || cat.sex}
						</td>
						<td className="cell icon">{CAT_ICON[cat.icon] || cat.icon || ''}</td>
						{STATS.map((s) => (
							<td
								key={s}
								className={joinClass('cell stat', getStatClass(getCatStat(cat, s)))}
							>
								{getCatStat(cat, s)}
							</td>
						))}
						<td className="cell total">{total}</td>
						<td className="cell info libido">{cat.libido}</td>
						<td
							className={joinClass(
								'cell info aggression',
								getAggressionClass(cat.aggression)
							)}
						>
							{cat.aggression}
						</td>
						<td className="cell info loves">{cat.loves || '—'}</td>
						<td className="cell info hates">{cat.hates || '—'}</td>
						<td className="cell spacer" aria-hidden="true"></td>
					</tr>
				);
			})}
		</tbody>
	);
}
