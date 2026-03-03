import './SvgMatchedRelationships.css';
import { isLineTypeActive, normalizeLineageName } from '../SvgRelationLogic.jsx';

export default function SvgMatchedRelationships({ hovIdx, ordered, positions, hiddenLineTypes }) {
	if (!isLineTypeActive(hiddenLineTypes, 'love')) {
		return null;
	}

	return (
		<g className="love-boxes">
			{/* Draw shared box for mutual love pairs */}
			{(() => {
				const boxes = [];
				const drawn = new Set();
				const boxOpacity = hovIdx !== null ? 0.05 : 0.7;
				for (let i = 0; i < ordered.length - 1; i++) {
					const a = ordered[i],
						b = ordered[i + 1];
					if (
						a.loves &&
						b.loves &&
						normalizeLineageName(a.loves) === normalizeLineageName(b.name) &&
						normalizeLineageName(b.loves) === normalizeLineageName(a.name) &&
						!drawn.has(a.name) &&
						!drawn.has(b.name)
					) {
						const pa = positions[i],
							pb = positions[i + 1];
						const minX = Math.min(pa.x, pb.x) - 36;
						const maxX = Math.max(pa.x, pb.x) + 36;
						const minY = Math.min(pa.y, pb.y) - 36;
						const maxY = Math.max(pa.y, pb.y) + 36;
						boxes.push(
							<rect
								key={`lovebox-${a.name}-${b.name}`}
								className="love-box"
								x={minX}
								y={minY}
								width={maxX - minX}
								height={maxY - minY}
								rx={22}
								fill="none"
								stroke="#4ade80"
								strokeWidth={4}
								opacity={boxOpacity}
							/>
						);
						drawn.add(a.name);
						drawn.add(b.name);
					}
				}
				return boxes;
			})()}
		</g>
	);
}
