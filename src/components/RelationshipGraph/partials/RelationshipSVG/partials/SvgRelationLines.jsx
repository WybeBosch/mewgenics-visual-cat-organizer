import {
	getAncestorNames,
	getGrandparentNames,
	getParentNames,
	isLineTypeActive,
	isSameRoom,
	isGrandparentGrandchild,
	isParentChild,
	isSibling,
	isFullSibling,
	isUncleAunt,
	getUncleAuntLabel,
	normalizeLineageName,
} from './SvgRelationLogic.jsx';
import { joinClass } from '../../../../../shared/utils/utils.jsx';

export default function SvgRelationLines({ hovIdx, ordered, positions, hiddenLineTypes }) {
	return (
		<g className="relation-lines">
			<defs>
				<marker
					id="arrow-related"
					viewBox="0 0 10 10"
					refX="10"
					refY="5"
					markerWidth="8"
					markerHeight="8"
					orient="auto-start-reverse"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" className="arrow-related" />
				</marker>
			</defs>
			{/* (shared lineage, nodes) */}
			{hovIdx !== null &&
				(() => {
					const hovCat = ordered[hovIdx];
					const hovAnc = getAncestorNames(hovCat);
					return ordered.map((other, oi) => {
						if (oi === hovIdx) return null;
						if (!isSameRoom(hovCat, other)) return null;
						const from = positions[hovIdx],
							to = positions[oi];
						const hovIsParent = getParentNames(other).includes(
							normalizeLineageName(hovCat.name)
						);
						if (isParentChild(hovCat, other)) {
							if (!isLineTypeActive(hiddenLineTypes, 'parent')) return null;
							// Draw line from parent to child, and add emoji at each end
							let parentPos, childPos;
							if (hovIsParent) {
								parentPos = from;
								childPos = to;
							} else {
								parentPos = to;
								childPos = from;
							}
							const dx = childPos.x - parentPos.x;
							const dy = childPos.y - parentPos.y;
							const dist = Math.sqrt(dx * dx + dy * dy) || 1;
							const nodeR = 28;
							const emojiPad = 18;
							const x1 = parentPos.x + dx * ((nodeR + emojiPad) / dist);
							const y1 = parentPos.y + dy * ((nodeR + emojiPad) / dist);
							const x2 = childPos.x - dx * (nodeR / dist);
							const y2 = childPos.y - dy * (nodeR / dist);
							return (
								<g key={`kin-${oi}`} className="kin-parent">
									<line
										className="kin-line"
										x1={x1}
										y1={y1}
										x2={x2}
										y2={y2}
										strokeWidth={3}
										opacity={0.6}
									/>
									{/* Pregnant emoji at parent end */}
									<text
										x={parentPos.x + dx * ((nodeR + emojiPad - 8) / dist)}
										y={parentPos.y + dy * ((nodeR + emojiPad - 8) / dist) + 8}
										fontSize={22}
										textAnchor="middle"
										dominantBaseline="middle"
										opacity={0.95}
									>
										🤰
									</text>
									{/* Baby emoji at child end - smaller and further from node */}
									<text
										x={childPos.x - dx * ((nodeR + 20) / dist)}
										y={childPos.y - dy * ((nodeR + 20) / dist) + 8}
										fontSize={16}
										textAnchor="middle"
										dominantBaseline="middle"
										opacity={0.95}
									>
										👶
									</text>
									<text
										className="kin-label"
										x={(x1 + x2) / 2}
										y={(y1 + y2) / 2 - 8}
										textAnchor="middle"
										fontSize={9}
										opacity={0.8}
									>
										{hovIsParent ? 'child' : 'parent'}
									</text>
								</g>
							);
						}
						if (isGrandparentGrandchild(hovCat, other)) {
							if (!isLineTypeActive(hiddenLineTypes, 'grandparent')) return null;
							const hovIsGrandparent = getGrandparentNames(other).includes(
								normalizeLineageName(hovCat.name)
							);
							let grandparentPos, grandchildPos;
							if (hovIsGrandparent) {
								grandparentPos = from;
								grandchildPos = to;
							} else {
								grandparentPos = to;
								grandchildPos = from;
							}
							const dx = grandchildPos.x - grandparentPos.x;
							const dy = grandchildPos.y - grandparentPos.y;
							const dist = Math.sqrt(dx * dx + dy * dy) || 1;
							const nodeR = 28;
							const emojiPad = 18;
							const x1 = grandparentPos.x + dx * ((nodeR + emojiPad) / dist);
							const y1 = grandparentPos.y + dy * ((nodeR + emojiPad) / dist);
							const x2 = grandchildPos.x - dx * (nodeR / dist);
							const y2 = grandchildPos.y - dy * (nodeR / dist);
							return (
								<g key={`kin-${oi}`} className="kin-grandparent">
									<line
										className="kin-line"
										x1={x1}
										y1={y1}
										x2={x2}
										y2={y2}
										strokeWidth={2}
										strokeDasharray="6,3"
										opacity={0.6}
									/>
									<text
										x={grandparentPos.x + dx * ((nodeR + emojiPad - 8) / dist)}
										y={
											grandparentPos.y +
											dy * ((nodeR + emojiPad - 8) / dist) +
											8
										}
										fontSize={20}
										textAnchor="middle"
										dominantBaseline="middle"
										opacity={0.95}
									>
										👴
									</text>
									<text
										x={grandchildPos.x - dx * ((nodeR + 20) / dist)}
										y={grandchildPos.y - dy * ((nodeR + 20) / dist) + 8}
										fontSize={16}
										textAnchor="middle"
										dominantBaseline="middle"
										opacity={0.95}
									>
										👶
									</text>
									<text
										className="kin-label"
										x={(x1 + x2) / 2}
										y={(y1 + y2) / 2 - 8}
										textAnchor="middle"
										fontSize={9}
										opacity={0.8}
									>
										{hovIsGrandparent ? 'grandchild' : 'grandparent'}
									</text>
								</g>
							);
						}
						const otherAnc = getAncestorNames(other);
						const shared = hovAnc.filter((a) => otherAnc.includes(a));
						if (shared.length === 0) return null;
						const sibling = isSibling(hovCat, other);
						if (sibling && !isLineTypeActive(hiddenLineTypes, 'sibling')) return null;
						if (!sibling && !isLineTypeActive(hiddenLineTypes, 'related')) return null;
						return (
							<g
								key={`kin-${oi}`}
								className={joinClass({
									'kin-sibling': sibling,
									'kin-related': !sibling,
								})}
							>
								<line
									className="kin-line"
									x1={from.x}
									y1={from.y}
									x2={to.x}
									y2={to.y}
									strokeWidth={sibling ? 3 : 2}
									strokeDasharray={sibling ? 'none' : '8,4'}
									opacity={0.6}
									markerEnd={!sibling ? 'url(#arrow-related)' : undefined}
								/>
								<text
									className="kin-label"
									x={(from.x + to.x) / 2}
									y={(from.y + to.y) / 2 - 8}
									textAnchor="middle"
									fontSize={9}
									opacity={0.8}
								>
									{sibling
										? isFullSibling(hovCat, other)
											? 'sibling'
											: 'half-sibling'
										: isUncleAunt(hovCat, other)
											? getUncleAuntLabel(hovCat, other)
											: 'cousin'}
								</text>
							</g>
						);
					});
				})()}
		</g>
	);
}
