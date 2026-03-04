import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react';
import { SEX_ICON } from '../../../../../../shared/config/config.ts';
import { getCatId, getCatSex } from '../../../../../../shared/utils/catDataUtils.ts';
import { joinClass } from '../../../../../../shared/utils/utils.tsx';
import type { GraphPosition } from '../../../../RelationshipGraph.types.ts';
import type { CatRecord } from '../../../../../../AppLogic.types.ts';
import './SvgCatNodes.css';

export default function SvgCatNodes({
	hovIdx,
	ordered,
	positions,
	setHoveredCatId,
	setSelectedCatId,
	selectedCatId,
}: {
	hovIdx: number | null;
	ordered: CatRecord[];
	positions: GraphPosition[];
	setHoveredCatId: Dispatch<SetStateAction<string | number | null>>;
	setSelectedCatId: Dispatch<SetStateAction<string | number | null>>;
	selectedCatId: string | number | null;
}) {
	function getCircleStrokeWidth(i: number, hoveredIndex: number | null) {
		return hoveredIndex === i ? 3.5 : 2.5;
	}

	function getNodeSexClass(sex: unknown) {
		const normalizedSex = String(sex || '').toLowerCase();
		if (normalizedSex === 'male' || normalizedSex === 'female' || normalizedSex === 'herm') {
			return `sex-${normalizedSex}`;
		}
		return 'sex-unknown';
	}

	function getNameFontSize(name: string) {
		if (name.length > 10) return 8;
		if (name.length > 8) return 9;
		return 11;
	}

	function getDisplayName(name: string) {
		return name.length > 14 ? `${name.slice(0, 13)}…` : name;
	}

	function getSexIcon(sex: unknown) {
		const normalizedSex = String(sex || '').toLowerCase();
		return SEX_ICON[normalizedSex as keyof typeof SEX_ICON] || sex;
	}

	function handleMouseEnter(id: string) {
		return () => setHoveredCatId(id);
	}

	function handleMouseLeave() {
		return () => setHoveredCatId(null);
	}

	function handleClick(id: string) {
		return (event: ReactMouseEvent<SVGGElement>) => {
			event.stopPropagation();
			setSelectedCatId(selectedCatId === id ? null : id);
		};
	}

	return (
		<g className="nodes">
			{positions.map((p, i) => {
				const cat = ordered[i];
				const catId = getCatId(cat, `${String(cat?.name || 'cat')}-${i}`);
				const catSex = getCatSex(cat);
				const catName = String(cat.name || '');

				return (
					<g
						key={catId || p.name}
						className={joinClass('node', getNodeSexClass(catSex), {
							'is-hovered': hovIdx === i,
						})}
						onMouseEnter={handleMouseEnter(catId)}
						onMouseLeave={handleMouseLeave()}
						onClick={handleClick(catId)}
					>
						<circle
							className="circle"
							cx={p.x}
							cy={p.y}
							r={p.nodeR || 28}
							strokeWidth={getCircleStrokeWidth(i, hovIdx)}
						/>
						<text
							className="name"
							x={p.x}
							y={p.y - 2}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={getNameFontSize(catName)}
							fontWeight={600}
						>
							{getDisplayName(catName)}
						</text>
						<text
							className="sex"
							x={p.x}
							y={p.y + 12}
							textAnchor="middle"
							fontSize={10}
						>
							{String(getSexIcon(catSex) || '')}
						</text>
					</g>
				);
			})}
		</g>
	);
}
