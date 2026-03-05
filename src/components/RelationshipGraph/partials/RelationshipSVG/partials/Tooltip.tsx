import { sharedTooltipContents } from '../../../../../shared/utils/utils.tsx';
import type { GraphPosition } from '../../../RelationshipGraph.types.ts';
import type { CatRecord } from '../../../../../AppLogic.types.ts';

export default function Tooltip({ allCats, selIdx, ordered, positions, W }: { allCats: CatRecord[]; selIdx: number | null; ordered: CatRecord[]; positions: GraphPosition[]; W: number }) {
	if (selIdx === null || !ordered || !positions || !ordered[selIdx] || !positions[selIdx]) {
		return <></>;
	}

	const cat = ordered[selIdx];
	const pos = positions[selIdx];
	const buildTooltip = (sourceCat: CatRecord) => sharedTooltipContents(sourceCat, allCats);
	const lines = buildTooltip(cat);

	const getTooltipProps = (sourcePos: GraphPosition, sourceLines: typeof lines) => {
		const tipW = 220;
		const tipH = 20 + sourceLines.length * 22;
		let tx = sourcePos.x - tipW / 2;
		let ty = sourcePos.y - 40 - tipH;
		if (ty < 5) ty = sourcePos.y + 38;
		if (tx < 5) tx = 5;
		if (tx + tipW > W - 5) tx = W - tipW - 5;
		return { tipW, tipH, tx, ty };
	};

	const { tipW, tipH, tx, ty } = getTooltipProps(pos, lines);

	return (
		<g>
			<rect className="tooltip-panel" x={tx} y={ty} width={tipW} height={tipH} rx={8} strokeWidth={1} opacity={0.95} />
			<text className="tooltip-title" x={tx + tipW / 2} y={ty + 16} textAnchor="middle" fontSize={12} fontWeight={700}>
				{String(cat.name || '')}
			</text>
			{lines.map((line, li) => (
				<g key={li}>
					<text className="tooltip-label" x={tx + 10} y={ty + 36 + li * 22} fontSize={10}>
						{line.label}:
					</text>
					<text className="tooltip-value" x={tx + tipW - 10} y={ty + 36 + li * 22} textAnchor="end" fontSize={10}>
						{line.value}
					</text>
				</g>
			))}
		</g>
	);
}
