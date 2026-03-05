import { useEffect, useRef } from 'react';
import { Tooltip } from '../../../../../../shared/components/Tooltip/Tooltip.tsx';
import { STATS, SEX_ICON, CAT_ICON, PARTNER_ICONS } from '../../../../../../shared/config/config.ts';
import { TableTooltipPopup, joinClass } from '../../../../../../shared/utils/utils.tsx';
import {
	getAge,
	getAggressionLabel,
	getAggressionScore,
	getCatId,
	getCatGenealogyValue,
	getLibidoLabel,
	getLibidoScore,
	getCatSex,
	getCatStat,
} from '../../../../../../shared/utils/catDataUtils.ts';
import type { NoCatsFoundWarningProps, TableBodyProps } from './TableBody.types.ts';
import './TableBody.css';

function toDisplayText(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—';
	return String(value);
}

function toIconValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	return String(value);
}

function NoCatsFoundWarning({ columnsLength }: NoCatsFoundWarningProps) {
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
	getPartnerInOtherRoom,
	highlightedCatId,
	onPartnerSearch,
}: TableBodyProps) {
	const noCatsFound = sorted.length === 0;
	const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);

	useEffect(() => {
		if (highlightedCatId && highlightedRowRef.current) {
			highlightedRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}, [highlightedCatId]);

	function getAggressionClass(aggressionScore: number | null): string {
		if (aggressionScore === null) return '';
		if (aggressionScore < 1 / 3) return 'low';
		if (aggressionScore < 2 / 3) return '';
		return 'high';
	}

	function getLibidoClass(libidoScore: number | null): string {
		if (libidoScore === null) return '';
		if (libidoScore < 1 / 3) return 'low';
		if (libidoScore < 2 / 3) return '';
		return 'high';
	}

	function getAgeClass(age: number | null): string {
		if (age === null) return 'unknown';
		if (age <= 1) return 'kitten';
		return '';
	}

	function getStatClass(statValue: number): string {
		if (statValue >= 7) return 'high';
		if (statValue <= 4) return 'low';
		return '';
	}

	return (
		<tbody className="table-body">
			{noCatsFound ? <NoCatsFoundWarning columnsLength={columns.length} /> : null}
			{sorted.map((cat, index) => {
				const fallbackName = toIconValue(cat.name);
				const catId = getCatId(cat, `${fallbackName}-${index}`);
				const catSex = getCatSex(cat);
				const total = totalStat(cat);
				const age = getAge(cat);
				const isHovered = hoveredCatId === catId;
				const isHighlighted = highlightedCatId === catId;
				const partnerInfo = getPartnerInOtherRoom(cat);

				const iconValue = toIconValue(cat.icon);
				const sexLabel = toIconValue(cat.sex);
				const libidoScore = getLibidoScore(cat);
				const libido = getLibidoLabel(cat);
				const aggressionScore = getAggressionScore(cat);
				const aggression = getAggressionLabel(cat);

				return (
					<tr
						key={`${catId}${index}`}
						ref={isHighlighted ? highlightedRowRef : undefined}
						className={joinClass('row', {
							hovered: isHovered,
							'search-match': isHighlighted,
						})}
						onMouseEnter={() => setHoveredCatId(catId)}
						onMouseLeave={() => setHoveredCatId(null)}
					>
						<TableTooltipPopup cat={cat} allCats={cats} />
						<td className="cell partner-indicator">
						{partnerInfo ? (
							<Tooltip
								content={`This cat's partner is in room ${partnerInfo.partnerRoom} and its partner's name is ${partnerInfo.partnerName}`}
							>
								<span
									className="partner-detective"
									onClick={() => onPartnerSearch(partnerInfo.partnerName)}
									style={{ cursor: 'pointer' }}
								>
									{PARTNER_ICONS.detective}
								</span>
							</Tooltip>
						) : (
							''
						)}
					</td>
						<td className="cell stray">
							{getCatGenealogyValue(cat, 'stray') ? '✔' : ''}
						</td>
						<td
							className={joinClass('cell age', getAgeClass(age))}
							title={
								age !== null ? `${age} day${age === 1 ? '' : 's'} old` : 'Unknown'
							}
						>
							{age !== null ? age : '—'}
						</td>
						<td className={joinClass('cell sex', catSex || 'unknown')}>
							{SEX_ICON[catSex as keyof typeof SEX_ICON] || sexLabel}
						</td>
						<td className="cell icon">
							{CAT_ICON[iconValue as keyof typeof CAT_ICON] || iconValue || ''}
						</td>
						{STATS.map((statKey) => (
							<td
								key={statKey}
								className={joinClass(
									'cell stat',
									getStatClass(getCatStat(cat, statKey))
								)}
							>
								{getCatStat(cat, statKey)}
							</td>
						))}
						<td className="cell total">{total}</td>
						<td className={joinClass('cell info libido', getLibidoClass(libidoScore))}>
							{libido}
						</td>
						<td
							className={joinClass(
								'cell info aggression',
								getAggressionClass(aggressionScore)
							)}
						>
							{aggression}
						</td>
						<td className="cell info loves">{toDisplayText(cat.loves)}</td>
						<td className="cell info hates">{toDisplayText(cat.hates)}</td>
						<td className="cell spacer" aria-hidden="true"></td>
					</tr>
				);
			})}
		</tbody>
	);
}
