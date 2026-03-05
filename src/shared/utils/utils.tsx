import { useState } from 'react';
import type { CatRecord } from '../../AppLogic.types.ts';
import { TooltipPanel } from '../components/Tooltip/Tooltip.tsx';
import { getCatGenealogyValue, getCatId } from './catDataUtils.ts';
import type {
	ClassInput,
	TableTooltipPopupProps,
	TooltipLine,
	TooltipPosition,
	TooltipStyle,
} from './utils.types.ts';
import './utils.css';

function joinClass(...parts: ClassInput[]): string {
	const classNames: string[] = [];

	const appendPart = (part: ClassInput): void => {
		if (!part) return;

		if (typeof part === 'string' || typeof part === 'number') {
			classNames.push(String(part));
			return;
		}

		if (Array.isArray(part)) {
			part.forEach(appendPart);
			return;
		}

		if (typeof part === 'object') {
			Object.entries(part).forEach(([className, shouldInclude]) => {
				if (shouldInclude) {
					classNames.push(className);
				}
			});
		}
	};

	parts.forEach(appendPart);

	return classNames.join(' ');
}

function logIfEnabled(...args: unknown[]): void {
	const enableLogging = import.meta.env.DEV;

	if (enableLogging || window.enableLogging === true) {
		// eslint-disable-next-line no-console
		console.log(...args);
	}
}

function sharedTooltipContents(cat: CatRecord, allCats: CatRecord[]): TooltipLine[] {
	const isCatReference = (value: unknown): value is string | number =>
		typeof value === 'string' || typeof value === 'number';

	const displayName = (name: string | number | null | undefined): string | null => {
		if (!name) return null;
		const found = allCats.find(
			(candidate) => candidate.name === name || getCatId(candidate) === name
		);
		return found ? String(found.name) : String(name);
	};

	const isParentStray = (candidate: CatRecord, num: 1 | 2): boolean => {
		if (num === 1) {
			return (
				!getCatGenealogyValue(candidate, 'grandparent1') &&
				!getCatGenealogyValue(candidate, 'grandparent2')
			);
		}
		return (
			!getCatGenealogyValue(candidate, 'grandparent3') &&
			!getCatGenealogyValue(candidate, 'grandparent4')
		);
	};

	if (getCatGenealogyValue(cat, 'stray')) return [{ label: 'Stray', value: 'Yes' }];

	const lines: TooltipLine[] = [];
	const parent1 = getCatGenealogyValue(cat, 'parent1');
	const parent2 = getCatGenealogyValue(cat, 'parent2');

	if (parent1 || parent2) {
		const p1 =
			parent1 && isCatReference(parent1)
				? `${displayName(parent1)}${isParentStray(cat, 1) ? ' (Stray)' : ''}`
				: '—';
		const p2 =
			parent2 && isCatReference(parent2)
				? `${displayName(parent2)}${isParentStray(cat, 2) ? ' (Stray)' : ''}`
				: '—';
		lines.push({ label: 'Parents', value: `${p1}  ×  ${p2}` });
	}

	const grandparents = [
		getCatGenealogyValue(cat, 'grandparent1'),
		getCatGenealogyValue(cat, 'grandparent2'),
		getCatGenealogyValue(cat, 'grandparent3'),
		getCatGenealogyValue(cat, 'grandparent4'),
	];

	if (grandparents.some((grandparent) => grandparent)) {
		const grandparentNames = grandparents.map((grandparent) =>
			grandparent && isCatReference(grandparent) ? displayName(grandparent) : '—'
		);
		lines.push({
			label: 'GP (P1 side)',
			value: `${grandparentNames[0]}  ×  ${grandparentNames[1]}`,
		});
		lines.push({
			label: 'GP (P2 side)',
			value: `${grandparentNames[2]}  ×  ${grandparentNames[3]}`,
		});
	}

	if (cat.loves) {
		const partner = allCats.find(
			(candidate) => candidate.name === cat.loves || getCatId(candidate) === cat.loves
		);
		if (partner && partner.room && cat.room && partner.room !== cat.room) {
			lines.push({ label: '—', value: '' });
			lines.push({
				label: 'Partner in other room',
				value: `${partner.name}, ${partner.room}`,
			});
		}
	}

	return lines;
}

function TableTooltipPopup({ cat, allCats }: TableTooltipPopupProps) {
	const [show, setShow] = useState(false);
	const [pos, setPos] = useState<TooltipPosition>({ x: 0, y: 0 });
	const lines = sharedTooltipContents(cat, allCats);

	return (
		<td
			className="tooltip-popup"
			onMouseEnter={() => setShow(true)}
			onMouseLeave={() => setShow(false)}
			onMouseMove={(event) => setPos({ x: event.clientX, y: event.clientY })}
		>
			<span className="name">{String(cat.name)}</span>
			{show && (
				<TooltipPanel
					className="cursor-following"
					style={
						{
							'--tooltip-top': `${pos.y - 10}px`,
							'--tooltip-left': `${pos.x + 16}px`,
						} as TooltipStyle
					}
				>
					<div className="title">{String(cat.name)}</div>
					{lines.map((line, index) => (
						<div key={index} className="line">
							<span className="label">{line.label}:</span>
							<span className="value">{line.value}</span>
						</div>
					))}
				</TooltipPanel>
			)}
		</td>
	);
}

export { sharedTooltipContents, TableTooltipPopup, logIfEnabled, joinClass };
