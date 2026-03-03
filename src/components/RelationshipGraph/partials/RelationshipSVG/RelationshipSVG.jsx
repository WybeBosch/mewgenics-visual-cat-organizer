import { useState } from 'react';

import { getCatId, isKitten } from '../../../../shared/utils/catDataUtils.jsx';
import Tooltip from './partials/Tooltip.jsx';
import TooltipCloseArea from './partials/TooltipCloseArea.jsx';
import SvgLoveHateLines from './partials/SvgLoveHateLines.jsx';
import SvgMarkers from './partials/SvgMarkers.jsx';
import SvgMatchedRelationships from './partials/SvgMatchedRelationships/SvgMatchedRelationships.jsx';
import SvgRelationLines from './partials/SvgRelationLines.jsx';
import SvgInbreedingPercentages from './partials/SvgInbreedingPercentages.jsx';
import SvgCatNodes from './partials/SvgCatNodes/SvgCatNodes.jsx';
import {
	areMutualLovePair,
	hasOneWayLoveInRoom,
	isLineTypeActive,
} from './partials/SvgRelationLogic.jsx';

export default function RelationshipSVG({
	cats,
	allCats,
	hoveredCatId,
	setHoveredCatId,
	hiddenLineTypes,
}) {
	const [selectedCatId, setSelectedCatId] = useState(null);

	// Reorder cats: 1. mutual pairs, 2. one-way lovers, 3. others
	const ordered = (() => {
		if (!isLineTypeActive(hiddenLineTypes, 'love')) {
			return [...cats];
		}

		const pairs = [];
		const paired = new Set();
		cats.forEach((a) => {
			const aId = getCatId(a);
			if (paired.has(aId)) return;
			const match = cats.find((b) => areMutualLovePair(a, b));
			if (match && !paired.has(getCatId(match))) {
				pairs.push([a, match]);
				paired.add(aId);
				paired.add(getCatId(match));
			}
		});

		// Unpaired cats
		const unpaired = cats.filter((c) => !paired.has(getCatId(c)));

		// One-way lovers: cats that love someone in the room, but are not in a mutual pair
		const oneWayLovers = [];
		const others = [];
		unpaired.forEach((cat) => {
			if (hasOneWayLoveInRoom(cat, cats)) {
				oneWayLovers.push(cat);
			} else {
				others.push(cat);
			}
		});

		const result = [];
		for (const [a, b] of pairs) {
			result.push(a, b);
		}
		for (const c of oneWayLovers) {
			result.push(c);
		}
		for (const c of others) {
			result.push(c);
		}
		return result;
	})();

	// Switch to row layout if there are 15 or more cats
	const useRowLayout = ordered.length >= 15;

	const selected = ordered.findIndex((c) => getCatId(c) === selectedCatId);
	const selIdx = selected >= 0 ? selected : null;
	const hovered = ordered.findIndex((c) => getCatId(c) === hoveredCatId);
	const hovIdx = hovered >= 0 ? hovered : null;

	const W = 800,
		H = useRowLayout ? 20 + Math.ceil(ordered.length / 8) * 110 : 500;
	const cx = W / 2,
		cy = H / 2;
	const radius = Math.min(200, 60 + ordered.length * 12);

	// Node radius based on age
	const getNodeRadius = (cat) => {
		if (isKitten(cat)) return 18;
		return 28;
	};

	let positions;
	if (useRowLayout) {
		// Place cats in rows, 8 per row, with more spacing
		const perRow = 8;
		const rowHeight = 110;
		const startY = 70;
		const marginX = 60;
		const usableW = W - marginX * 2;
		positions = ordered.map((cat, i) => {
			const row = Math.floor(i / perRow);
			const col = i % perRow;
			const y = startY + row * rowHeight;
			const x = marginX + col * (usableW / (Math.min(perRow, ordered.length) - 1));
			return {
				name: cat.name,
				sex: cat.sex,
				x,
				y,
				nodeR: getNodeRadius(cat),
			};
		});
	} else {
		positions = ordered.map((cat, i) => {
			const angle = (i / ordered.length) * 2 * Math.PI - Math.PI / 2;
			return {
				name: cat.name,
				sex: cat.sex,
				x: cx + radius * Math.cos(angle),
				y: cy + radius * Math.sin(angle),
				nodeR: getNodeRadius(cat),
			};
		});
	}

	return (
		<svg className="graph-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
			<SvgMarkers />

			<SvgLoveHateLines
				hovIdx={hovIdx}
				ordered={ordered}
				positions={positions}
				hiddenLineTypes={hiddenLineTypes}
			/>
			<SvgMatchedRelationships
				hovIdx={hovIdx}
				ordered={ordered}
				positions={positions}
				hiddenLineTypes={hiddenLineTypes}
			/>
			<SvgRelationLines
				hovIdx={hovIdx}
				ordered={ordered}
				positions={positions}
				hiddenLineTypes={hiddenLineTypes}
			/>
			<SvgInbreedingPercentages
				hovIdx={hovIdx}
				ordered={ordered}
				positions={positions}
				hiddenLineTypes={hiddenLineTypes}
				allCats={allCats}
			/>

			<TooltipCloseArea selectedCatId={selectedCatId} setSelectedCatId={setSelectedCatId} />
			<SvgCatNodes
				hovIdx={hovIdx}
				ordered={ordered}
				positions={positions}
				setHoveredCatId={setHoveredCatId}
				setSelectedCatId={setSelectedCatId}
				selectedCatId={selectedCatId}
			/>

			<Tooltip
				allCats={allCats}
				selIdx={selIdx}
				ordered={ordered}
				positions={positions}
				W={W}
			/>
		</svg>
	);
}
