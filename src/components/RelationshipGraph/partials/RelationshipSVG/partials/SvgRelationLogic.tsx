import {
	getCatBirthday,
	getCatGenealogyValue,
	getCatId,
} from '../../../../../shared/utils/catDataUtils.ts';
import type {
	FamilySummary,
	RelatedCat,
	RelatedPosition,
	RelationKinshipContext,
	RoomInbreedingStats,
} from './SvgRelationLogic.types.ts';

function normalizeLineageName(value: unknown): string {
	return String(value || '')
		.replace(/☠️/g, '')
		.trim()
		.toLowerCase();
}

function getParentNames(cat: RelatedCat): string[] {
	return [getCatGenealogyValue(cat, 'parent1'), getCatGenealogyValue(cat, 'parent2')]
		.map(normalizeLineageName)
		.filter(Boolean);
}

function getGrandparentNames(cat: RelatedCat): string[] {
	return [
		getCatGenealogyValue(cat, 'grandparent1'),
		getCatGenealogyValue(cat, 'grandparent2'),
		getCatGenealogyValue(cat, 'grandparent3'),
		getCatGenealogyValue(cat, 'grandparent4'),
	]
		.map(normalizeLineageName)
		.filter(Boolean);
}

function getAncestorNames(cat: RelatedCat): string[] {
	return [
		getCatGenealogyValue(cat, 'parent1'),
		getCatGenealogyValue(cat, 'parent2'),
		getCatGenealogyValue(cat, 'grandparent1'),
		getCatGenealogyValue(cat, 'grandparent2'),
		getCatGenealogyValue(cat, 'grandparent3'),
		getCatGenealogyValue(cat, 'grandparent4'),
	]
		.map(normalizeLineageName)
		.filter(Boolean);
}

function hasOverlap(a: string[], b: string[]): boolean {
	const bSet = new Set(b);
	return a.some((item) => bSet.has(item));
}

function isSameRoom(a: RelatedCat | null | undefined, b: RelatedCat | null | undefined): boolean {
	return Boolean(a && b && a.room && b.room && a.room === b.room);
}

function isLineTypeActive(
	hiddenLineTypes: Set<string> | Set<string | number> | null | undefined,
	lineType: string
): boolean {
	return !hiddenLineTypes?.has(lineType);
}

function areMutualLovePair(a: RelatedCat, b: RelatedCat): boolean {
	if (!a || !b || getCatId(a) === getCatId(b)) return false;
	const aLoves = normalizeLineageName(a.loves);
	const bLoves = normalizeLineageName(b.loves);
	if (!aLoves || !bLoves) return false;
	return aLoves === normalizeLineageName(b.name) && bLoves === normalizeLineageName(a.name);
}

function hasOneWayLoveInRoom(cat: RelatedCat, cats: RelatedCat[]): boolean {
	const lovesName = normalizeLineageName(cat?.loves);
	if (!lovesName) return false;
	return cats.some(
		(other) =>
			getCatId(other) !== getCatId(cat) && normalizeLineageName(other.name) === lovesName
	);
}

function addGhost(
	lookup: Map<string, RelatedCat>,
	name: unknown,
	parent1: unknown,
	parent2: unknown
) {
	if (!name) return;
	const key = normalizeLineageName(name);
	if (lookup.has(key)) {
		const existing = lookup.get(key);
		if (!existing || existing.birthday !== -Infinity) return;
		if (!existing.parent1 && parent1) existing.parent1 = parent1;
		if (!existing.parent2 && parent2) existing.parent2 = parent2;
		return;
	}
	lookup.set(key, {
		key: -1,
		id64: -1,
		name: String(name),
		sex: '',
		age: 0,
		level: 0,
		class: '',
		retired: false,
		dead: false,
		donated: false,
		stats: {
			STR: 0,
			DEX: 0,
			CON: 0,
			INT: 0,
			SPD: 0,
			CHA: 0,
			LCK: 0,
		},
		abilities: {
			active: [],
			passive: [],
			disorder: [],
		},
		mutations: {},
		icon: '',
		libido: 'average',
		libido_raw: 0.5,
		aggression: 'average',
		aggression_raw: 0.5,
		parent1: parent1 || '',
		parent2: parent2 || '',
		genealogy: {
			stray: false,
			parent1: String(parent1 || ''),
			parent2: String(parent2 || ''),
			grandparent1: '',
			grandparent2: '',
			grandparent3: '',
			grandparent4: '',
		},
		_variant: '',
		_name_len: 0,
		_name_end: 0,
		_level_offset: 0,
		_birth_day_offset: 0,
		_stats_offset: 0,
		_birth_day: 0,
		loves: '',
		hates: '',
		birthday: -Infinity,
		room: '',
	});
}

function buildGhostAncestors(cats: RelatedCat[], lookup: Map<string, RelatedCat>) {
	for (const cat of cats) {
		const parent1 = getCatGenealogyValue(cat, 'parent1');
		const parent2 = getCatGenealogyValue(cat, 'parent2');
		const grandparent1 = getCatGenealogyValue(cat, 'grandparent1');
		const grandparent2 = getCatGenealogyValue(cat, 'grandparent2');
		const grandparent3 = getCatGenealogyValue(cat, 'grandparent3');
		const grandparent4 = getCatGenealogyValue(cat, 'grandparent4');

		addGhost(lookup, parent1, grandparent1, grandparent2);
		addGhost(lookup, parent2, grandparent3, grandparent4);
		addGhost(lookup, grandparent1, '', '');
		addGhost(lookup, grandparent2, '', '');
		addGhost(lookup, grandparent3, '', '');
		addGhost(lookup, grandparent4, '', '');
	}
}

function buildCatLookup(cats: RelatedCat[]): Map<string, RelatedCat> {
	const lookup = new Map<string, RelatedCat>();
	for (const cat of cats) {
		const key = normalizeLineageName(cat.name);
		if (key && !lookup.has(key)) {
			lookup.set(key, cat);
		}
	}
	buildGhostAncestors(cats, lookup);
	return lookup;
}

function findCatByName(cats: RelatedCat[], name: unknown): RelatedCat | null {
	if (!name) return null;
	const clean = normalizeLineageName(name);
	return cats.find((cat) => normalizeLineageName(cat.name) === clean) || null;
}

function findPositionByName(positions: RelatedPosition[], name: unknown): RelatedPosition | null {
	if (!name) return null;
	const clean = normalizeLineageName(name);
	return positions.find((position) => normalizeLineageName(position.name) === clean) || null;
}

function isParentChild(a: RelatedCat, b: RelatedCat): boolean {
	const aParents = getParentNames(a);
	const bParents = getParentNames(b);
	const aName = normalizeLineageName(a.name);
	const bName = normalizeLineageName(b.name);

	const aIsParentOfB = bParents.includes(aName);
	const bIsParentOfA = aParents.includes(bName);

	return aIsParentOfB || bIsParentOfA;
}

function isGrandparentGrandchild(a: RelatedCat, b: RelatedCat): boolean {
	const aGrandparents = getGrandparentNames(a);
	const bGrandparents = getGrandparentNames(b);
	const aName = normalizeLineageName(a.name);
	const bName = normalizeLineageName(b.name);

	return bGrandparents.includes(aName) || aGrandparents.includes(bName);
}

function isSibling(a: RelatedCat, b: RelatedCat): boolean {
	return hasOverlap(getParentNames(a), getParentNames(b));
}

function isFullSibling(a: RelatedCat, b: RelatedCat): boolean {
	const aParents = getParentNames(a);
	const bParents = getParentNames(b);
	if (aParents.length < 2 || bParents.length < 2) return false;
	const aSet = new Set(aParents);
	return bParents.every((parent) => aSet.has(parent));
}

function isRelated(a: RelatedCat, b: RelatedCat): boolean {
	return hasOverlap(getAncestorNames(a), getAncestorNames(b));
}

function isUncleAunt(a: RelatedCat, b: RelatedCat): boolean {
	const aParents = getParentNames(a);
	const bParents = getParentNames(b);
	const aGrandparents = getGrandparentNames(a);
	const bGrandparents = getGrandparentNames(b);
	return hasOverlap(aParents, bGrandparents) || hasOverlap(bParents, aGrandparents);
}

function getUncleAuntLabel(hovCat: RelatedCat, other: RelatedCat): string {
	const hovParents = getParentNames(hovCat);
	const otherGrandparents = getGrandparentNames(other);
	const sex = String(other.sex || '').toLowerCase();

	if (hasOverlap(hovParents, otherGrandparents)) {
		if (sex === 'female') return 'niece';
		if (sex === 'male') return 'nephew';
		return 'nephew/niece';
	}
	if (sex === 'female') return 'aunt';
	if (sex === 'male') return 'uncle';
	return 'uncle/aunt';
}

function getFamilySummary(cats: RelatedCat[]): FamilySummary {
	const siblingCats = new Set<string>();
	const parentChildCats = new Set<string>();
	const grandparentChildCats = new Set<string>();
	const distantCats = new Set<string>();

	for (let i = 0; i < cats.length; i++) {
		const a = cats[i];
		const aKey = getCatId(a, `${a.name}-${i}`);

		for (let j = i + 1; j < cats.length; j++) {
			const b = cats[j];
			const bKey = getCatId(b, `${b.name}-${j}`);

			if (isParentChild(a, b)) {
				parentChildCats.add(aKey);
				parentChildCats.add(bKey);
				continue;
			}

			if (isGrandparentGrandchild(a, b)) {
				grandparentChildCats.add(aKey);
				grandparentChildCats.add(bKey);
				continue;
			}

			if (isSibling(a, b)) {
				siblingCats.add(aKey);
				siblingCats.add(bKey);
				continue;
			}

			if (isRelated(a, b)) {
				distantCats.add(aKey);
				distantCats.add(bKey);
			}
		}
	}

	return {
		siblings: siblingCats.size,
		parentChild: parentChildCats.size,
		grandparentChild: grandparentChildCats.size,
		distantlyRelated: distantCats.size,
		hasFamily:
			siblingCats.size > 0 ||
			parentChildCats.size > 0 ||
			grandparentChildCats.size > 0 ||
			distantCats.size > 0,
	};
}

function canBreed(a: RelatedCat, b: RelatedCat): boolean {
	if (!a || !b || getCatId(a) === getCatId(b)) return false;
	const sa = String(a.sex || '').toLowerCase();
	const sb = String(b.sex || '').toLowerCase();
	if (!sa || !sb) return false;
	if (sa === 'herm' || sb === 'herm') return true;
	return sa !== sb;
}

function kinship(
	x: RelatedCat,
	y: RelatedCat,
	lookup: Map<string, RelatedCat>,
	memo: Map<string, number>
): number {
	if (!x || !y) return 0;

	const nameX = normalizeLineageName(x.name);
	const nameY = normalizeLineageName(y.name);

	const bx = getCatBirthday(x) ?? Infinity;
	const by = getCatBirthday(y) ?? Infinity;
	let first = x;
	let second = y;
	let keyA = nameX;
	let keyB = nameY;
	if (by < bx || (by === bx && nameY < nameX)) {
		first = y;
		second = x;
		keyA = nameY;
		keyB = nameX;
	}

	if (bx === by) {
		const firstAncestors = getAncestorNames(first).length;
		const secondAncestors = getAncestorNames(second).length;
		if (secondAncestors < firstAncestors) {
			const tmp = first;
			first = second;
			second = tmp;
			const tmpKey = keyA;
			keyA = keyB;
			keyB = tmpKey;
		}
	}

	const key = `${keyA}|${keyB}`;
	if (memo.has(key)) return memo.get(key) || 0;

	memo.set(key, 0);

	let result: number;
	if (keyA === keyB) {
		const mother = lookup.get(normalizeLineageName(getCatGenealogyValue(first, 'parent1')));
		const father = lookup.get(normalizeLineageName(getCatGenealogyValue(first, 'parent2')));
		if (mother && father) {
			result = 0.5 * (1 + kinship(mother, father, lookup, memo));
		} else {
			result = 0.5;
		}
	} else {
		const motherY = lookup.get(normalizeLineageName(getCatGenealogyValue(second, 'parent1')));
		const fatherY = lookup.get(normalizeLineageName(getCatGenealogyValue(second, 'parent2')));
		if (!motherY && !fatherY) {
			result = 0;
		} else {
			result = 0;
			if (motherY) result += 0.5 * kinship(first, motherY, lookup, memo);
			if (fatherY) result += 0.5 * kinship(first, fatherY, lookup, memo);
		}
	}

	memo.set(key, result);
	return result;
}

function createKinshipContext(allCats: RelatedCat[]): RelationKinshipContext {
	return { lookup: buildCatLookup(allCats), memo: new Map<string, number>() };
}

function getInbreedingCoefficient(
	catX: RelatedCat,
	catY: RelatedCat,
	allCats: RelatedCat[],
	ctx?: RelationKinshipContext
): number {
	const { lookup, memo } = ctx || createKinshipContext(allCats);
	return kinship(catX, catY, lookup, memo);
}

function getRoomInbreedingStats(
	roomCats: RelatedCat[],
	allCats: RelatedCat[]
): RoomInbreedingStats {
	const ctx = createKinshipContext(allCats);
	let totalPairs = 0;
	let riskyPairs = 0;
	for (let i = 0; i < roomCats.length; i++) {
		for (let j = i + 1; j < roomCats.length; j++) {
			if (!canBreed(roomCats[i], roomCats[j])) continue;
			totalPairs++;
			const coeff = kinship(roomCats[i], roomCats[j], ctx.lookup, ctx.memo);
			if (coeff > 0) riskyPairs++;
		}
	}

	return { totalPairs, riskyPairs };
}

export {
	normalizeLineageName,
	getParentNames,
	getGrandparentNames,
	getAncestorNames,
	hasOverlap,
	isSameRoom,
	isLineTypeActive,
	areMutualLovePair,
	hasOneWayLoveInRoom,
	findCatByName,
	findPositionByName,
	isParentChild,
	isGrandparentGrandchild,
	isSibling,
	isFullSibling,
	isRelated,
	isUncleAunt,
	getUncleAuntLabel,
	getFamilySummary,
	canBreed,
	createKinshipContext,
	getInbreedingCoefficient,
	getRoomInbreedingStats,
};
