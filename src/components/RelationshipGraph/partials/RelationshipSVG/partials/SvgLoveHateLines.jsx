import {
	findCatByName,
	findPositionByName,
	isLineTypeActive,
	isSameRoom,
} from './SvgRelationLogic.jsx';
import { getCatId } from '../../../../../shared/utils/catDataUtils.jsx';

export default function SvgLoveHateLines({ hovIdx, ordered, positions, hiddenLineTypes }) {
	// Add hate and love edges
	const edges = [];
	ordered.forEach((cat) => {
		const from = findPositionByName(positions, cat.name);
		if (!from) return;
		// Hate edges
		if (cat.hates) {
			const toCat = findCatByName(ordered, cat.hates);
			if (isSameRoom(cat, toCat)) {
				const to = findPositionByName(positions, toCat.name);
				if (to)
					edges.push({
						from,
						to,
						type: 'hate',
						fromId: getCatId(cat),
						toId: getCatId(toCat),
						toName: toCat.name,
					});
			}
		}
		// Love edges
		if (cat.loves) {
			const toCat = findCatByName(ordered, cat.loves);
			if (isSameRoom(cat, toCat)) {
				const to = findPositionByName(positions, toCat.name);
				if (to) {
					edges.push({
						from,
						to,
						type: 'love',
						fromId: getCatId(cat),
						toId: getCatId(toCat),
						toName: toCat.name,
					});
				}
			}
		}
	});

	const getPath = (from, to, type) => {
		const dx = to.x - from.x,
			dy = to.y - from.y;
		const dist = Math.sqrt(dx * dx + dy * dy) || 1;
		const nodeR1 = from.nodeR || 28;
		const nodeR2 = to.nodeR || 28;
		const x1 = from.x + dx * (nodeR1 / dist),
			y1 = from.y + dy * (nodeR1 / dist);
		const x2 = from.x + dx * ((dist - nodeR2) / dist),
			y2 = from.y + dy * ((dist - nodeR2) / dist);
		const mx = (x1 + x2) / 2,
			my = (y1 + y2) / 2;
		const offset = type === 'love' ? 25 : -25;
		return {
			x1,
			y1,
			x2,
			y2,
			cx: mx + (-dy / dist) * offset,
			cy: my + (dx / dist) * offset,
		};
	};

	const visibleEdges = edges.filter((e) => {
		if (!isLineTypeActive(hiddenLineTypes, e.type)) return false;
		if (hovIdx === null) return true;
		const hoveredCatId = getCatId(ordered[hovIdx]);
		return e.fromId === hoveredCatId || e.toId === hoveredCatId;
	});

	const loveEdges = visibleEdges.filter((e) => e.type === 'love');
	const hateEdges = visibleEdges.filter((e) => e.type === 'hate');

	return (
		<>
			<g className="edge-love-group">
				{loveEdges.map((e, i) => {
					const p = getPath(e.from, e.to, e.type);
					return (
						<path
							key={`love-${i}`}
							className="edge-love"
							d={`M ${p.x1} ${p.y1} Q ${p.cx} ${p.cy} ${p.x2} ${p.y2}`}
							fill="none"
							strokeWidth={2}
							strokeDasharray="0"
							markerEnd="url(#arrow-love)"
							opacity={0.7}
						/>
					);
				})}
			</g>

			<g className="edge-hate-group">
				{hateEdges.map((e, i) => {
					const p = getPath(e.from, e.to, e.type);
					return (
						<path
							key={`hate-${i}`}
							className="edge-hate"
							d={`M ${p.x1} ${p.y1} Q ${p.cx} ${p.cy} ${p.x2} ${p.y2}`}
							fill="none"
							strokeWidth={2}
							strokeDasharray="6,4"
							markerEnd="url(#arrow-hate)"
							opacity={0.7}
						/>
					);
				})}
			</g>
		</>
	);
}
