import { useMemo, useState } from 'react';
import { InbreedingTable } from '../../../../../../shared/common/InbreedingTable/InbreedingTable.jsx';
import { Pill } from '../../../../../../shared/common/Pill/Pill.jsx';
import { getCatId } from '../../../../../../shared/utils/catDataUtils.jsx';
import './SvgRelationWarnings.css';

import {
	getParentNames,
	getRoomInbreedingStats,
	isParentChild,
	isRelated,
	isSibling,
	normalizeLineageName,
} from '../SvgRelationLogic.jsx';

function getCatKey(cat, index) {
	return getCatId(cat, `${cat.name || 'Unknown'}-${index}`);
}

function getCatDisplayName(cat) {
	const name = String(cat?.name || '').trim();
	return name || 'Unknown cat';
}

function addRelatedName(relatedMap, key, relatedName) {
	if (!relatedMap.has(key)) {
		relatedMap.set(key, new Set());
	}
	relatedMap.get(key).add(relatedName);
}

function toSortedRows(catMap, keySet, roleMap) {
	return [...keySet]
		.map((key) => {
			const name = catMap.get(key);
			const roles = roleMap?.get(key) || new Set();
			const isParent = roles.has('parent');
			const isChild = roles.has('child');
			const prefix = `${isParent ? '🤰' : ''}${isChild ? '👶' : ''}`;

			return {
				key,
				name,
				label: prefix ? `${prefix} ${name}` : name,
			};
		})
		.filter((item) => Boolean(item.name))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function toSortedRelatedLookup(relatedMap) {
	const lookup = new Map();

	for (const [key, values] of relatedMap.entries()) {
		lookup.set(
			key,
			[...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
		);
	}

	return lookup;
}

function getParentChildDirection(a, b) {
	const aParents = getParentNames(a);
	const bParents = getParentNames(b);
	const aName = normalizeLineageName(a.name);
	const bName = normalizeLineageName(b.name);

	return {
		aIsParent: bParents.includes(aName),
		bIsParent: aParents.includes(bName),
	};
}

function getWarningBuckets(cats = []) {
	const catMap = new Map();
	cats.forEach((cat, index) => {
		catMap.set(getCatKey(cat, index), getCatDisplayName(cat));
	});

	const siblings = new Set();
	const parentChild = new Set();
	const distantlyRelated = new Set();
	const parentChildRoles = new Map();
	const siblingRelatedMap = new Map();
	const parentChildRelatedMap = new Map();
	const distantlyRelatedMap = new Map();

	for (let i = 0; i < cats.length; i++) {
		const a = cats[i];
		const aKey = getCatKey(a, i);

		for (let j = i + 1; j < cats.length; j++) {
			const b = cats[j];
			const bKey = getCatKey(b, j);

			if (isParentChild(a, b)) {
				parentChild.add(aKey);
				parentChild.add(bKey);

				const direction = getParentChildDirection(a, b);

				if (direction.aIsParent) {
					if (!parentChildRoles.has(aKey)) {
						parentChildRoles.set(aKey, new Set());
					}
					parentChildRoles.get(aKey).add('parent');

					if (!parentChildRoles.has(bKey)) {
						parentChildRoles.set(bKey, new Set());
					}
					parentChildRoles.get(bKey).add('child');

					addRelatedName(parentChildRelatedMap, aKey, `👶 ${catMap.get(bKey)}`);
					addRelatedName(parentChildRelatedMap, bKey, `🤰 ${catMap.get(aKey)}`);
				}

				if (direction.bIsParent) {
					if (!parentChildRoles.has(bKey)) {
						parentChildRoles.set(bKey, new Set());
					}
					parentChildRoles.get(bKey).add('parent');

					if (!parentChildRoles.has(aKey)) {
						parentChildRoles.set(aKey, new Set());
					}
					parentChildRoles.get(aKey).add('child');

					addRelatedName(parentChildRelatedMap, bKey, `👶 ${catMap.get(aKey)}`);
					addRelatedName(parentChildRelatedMap, aKey, `🤰 ${catMap.get(bKey)}`);
				}

				continue;
			}

			if (isSibling(a, b)) {
				siblings.add(aKey);
				siblings.add(bKey);
				addRelatedName(siblingRelatedMap, aKey, catMap.get(bKey));
				addRelatedName(siblingRelatedMap, bKey, catMap.get(aKey));
				continue;
			}

			if (isRelated(a, b)) {
				distantlyRelated.add(aKey);
				distantlyRelated.add(bKey);
				addRelatedName(distantlyRelatedMap, aKey, catMap.get(bKey));
				addRelatedName(distantlyRelatedMap, bKey, catMap.get(aKey));
			}
		}
	}

	return {
		siblings: {
			rows: toSortedRows(catMap, siblings),
			relatedLookup: toSortedRelatedLookup(siblingRelatedMap),
		},
		parentChild: {
			rows: toSortedRows(catMap, parentChild, parentChildRoles),
			relatedLookup: toSortedRelatedLookup(parentChildRelatedMap),
		},
		distantlyRelated: {
			rows: toSortedRows(catMap, distantlyRelated),
			relatedLookup: toSortedRelatedLookup(distantlyRelatedMap),
		},
	};
}

function WarningPill({
	categoryKey,
	count,
	label,
	rows,
	relatedLookup,
	isOpen,
	onOpen,
	onClose,
	popupTitle,
}) {
	const [hoveredRowKey, setHoveredRowKey] = useState('');

	if (count < 1) {
		return null;
	}

	const hoveredRow = rows.find((row) => row.key === hoveredRowKey);
	const hoveredRelated = hoveredRowKey ? relatedLookup.get(hoveredRowKey) || [] : [];

	return (
		<Pill
			className={categoryKey}
			tabIndex={0}
			onMouseEnter={() => onOpen(categoryKey)}
			onMouseLeave={() => {
				setHoveredRowKey('');
				onClose();
			}}
			onFocus={() => onOpen(categoryKey)}
			onBlur={() => {
				setHoveredRowKey('');
				onClose();
			}}
		>
			{count} cats are {label}
			{isOpen ? (
				<div className="popup">
					{hoveredRow ? (
						<div className="related-popup">
							<div className="related-title">{hoveredRow.label} related to</div>
							<div className="related-list">
								{hoveredRelated.map((relatedName) => (
									<div
										className="related-item"
										key={`${hoveredRow.key}-${relatedName}`}
									>
										{relatedName}
									</div>
								))}
							</div>
						</div>
					) : null}

					<div className="popup-title">{popupTitle}</div>
					<div className="rows">
						{rows.map((row, index) => (
							<div
								key={`${categoryKey}-${row.key}`}
								className="row"
								onMouseEnter={() => setHoveredRowKey(row.key)}
							>
								<span className="row-index">{index + 1}</span>
								<span className="row-label">{row.label}</span>
							</div>
						))}
					</div>
				</div>
			) : null}
		</Pill>
	);
}

function formatPct(value) {
	const pct = value * 100;
	return Number.isInteger(pct) ? pct : parseFloat(pct.toFixed(2));
}

function SvgRelationWarnings({ cats = [], allCats = [] }) {
	const [hoveredCategory, setHoveredCategory] = useState('');
	const warningBuckets = useMemo(() => getWarningBuckets(cats), [cats]);
	const roomStats = useMemo(() => getRoomInbreedingStats(cats, allCats), [cats, allCats]);

	return (
		<div className="svg-relation-warnings">
			{roomStats.riskyPairs > 0 ? (
				<span className="room-inbreeding-stats">
					{roomStats.riskyPairs}/{roomStats.totalPairs} (
					{formatPct(roomStats.riskyPairs / roomStats.totalPairs)}%) risky pairings{' '}
					<span> - </span>
					<span className="popup">
						A risky pairing is a breedable pair (male + female or herm) whose offspring
						would be inbred due to shared ancestry.
						<br />
						<p>Examples of inbreeding include:</p>
						<InbreedingTable />
					</span>
				</span>
			) : null}
			<span>🚨 Inbreeding alert!</span>

			<WarningPill
				categoryKey="siblings"
				count={warningBuckets.siblings.rows.length}
				label="sibling"
				rows={warningBuckets.siblings.rows}
				relatedLookup={warningBuckets.siblings.relatedLookup}
				isOpen={hoveredCategory === 'siblings'}
				onOpen={setHoveredCategory}
				onClose={() => setHoveredCategory('')}
				popupTitle={`Which ${warningBuckets.siblings.rows.length} cats are siblings`}
			/>

			<WarningPill
				categoryKey="parent-child"
				count={warningBuckets.parentChild.rows.length}
				label="child/parent"
				rows={warningBuckets.parentChild.rows}
				relatedLookup={warningBuckets.parentChild.relatedLookup}
				isOpen={hoveredCategory === 'parent-child'}
				onOpen={setHoveredCategory}
				onClose={() => setHoveredCategory('')}
				popupTitle={`Which ${warningBuckets.parentChild.rows.length} cats are child/parent`}
			/>

			<WarningPill
				categoryKey="distantly-related"
				count={warningBuckets.distantlyRelated.rows.length}
				label="distantly related"
				rows={warningBuckets.distantlyRelated.rows}
				relatedLookup={warningBuckets.distantlyRelated.relatedLookup}
				isOpen={hoveredCategory === 'distantly-related'}
				onOpen={setHoveredCategory}
				onClose={() => setHoveredCategory('')}
				popupTitle={`Which ${warningBuckets.distantlyRelated.rows.length} cats are distantly related`}
			/>
		</div>
	);
}

export default SvgRelationWarnings;
