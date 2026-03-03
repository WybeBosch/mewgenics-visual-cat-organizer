import {
	getCatBirthday,
	getCatGenealogyValue,
	getCatId,
} from '../../../../../shared/utils/catDataUtils.jsx';

function normalizeLineageName(value) {
	return String(value || '')
		.replace(/☠️/g, '')
		.trim()
		.toLowerCase();
}

function getParentNames(cat) {
	return [getCatGenealogyValue(cat, 'parent1'), getCatGenealogyValue(cat, 'parent2')]
		.map(normalizeLineageName)
		.filter(Boolean);
}

function getGrandparentNames(cat) {
	return [
		getCatGenealogyValue(cat, 'grandparent1'),
		getCatGenealogyValue(cat, 'grandparent2'),
		getCatGenealogyValue(cat, 'grandparent3'),
		getCatGenealogyValue(cat, 'grandparent4'),
	]
		.map(normalizeLineageName)
		.filter(Boolean);
}

function getAncestorNames(cat) {
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

function hasOverlap(a, b) {
	const bSet = new Set(b);
	return a.some((item) => bSet.has(item));
}

function isSameRoom(a, b) {
	return Boolean(a && b && a.room && b.room && a.room === b.room);
}

function isLineTypeActive(hiddenLineTypes, lineType) {
	return !hiddenLineTypes?.has(lineType);
}

function areMutualLovePair(a, b) {
	if (!a || !b || getCatId(a) === getCatId(b)) return false;
	const aLoves = normalizeLineageName(a.loves);
	const bLoves = normalizeLineageName(b.loves);
	if (!aLoves || !bLoves) return false;
	return aLoves === normalizeLineageName(b.name) && bLoves === normalizeLineageName(a.name);
}

function hasOneWayLoveInRoom(cat, cats) {
	const lovesName = normalizeLineageName(cat?.loves);
	if (!lovesName) return false;
	return cats.some(
		(other) =>
			getCatId(other) !== getCatId(cat) && normalizeLineageName(other.name) === lovesName
	);
}

function addGhost(lookup, name, parent1, parent2) {
	if (!name) return;
	const key = normalizeLineageName(name);
	if (lookup.has(key)) {
		const existing = lookup.get(key);
		// Only update ghosts (birthday === -Infinity), never overwrite real cats
		if (existing.birthday !== -Infinity) return;
		// Fill in missing parents if the new call provides them
		if (!existing.parent1 && parent1) existing.parent1 = parent1;
		if (!existing.parent2 && parent2) existing.parent2 = parent2;
		return;
	}
	lookup.set(key, { name, parent1: parent1 || '', parent2: parent2 || '', birthday: -Infinity });
}

function buildGhostAncestors(cats, lookup) {
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

function buildCatLookup(cats) {
	const lookup = new Map();
	for (const cat of cats) {
		const key = normalizeLineageName(cat.name);
		if (key && !lookup.has(key)) {
			lookup.set(key, cat);
		}
	}
	buildGhostAncestors(cats, lookup);
	return lookup;
}

function findCatByName(cats, name) {
	if (!name) return null;
	const clean = normalizeLineageName(name);
	return cats.find((cat) => normalizeLineageName(cat.name) === clean) || null;
}

function findPositionByName(positions, name) {
	if (!name) return null;
	const clean = normalizeLineageName(name);
	return positions.find((position) => normalizeLineageName(position.name) === clean) || null;
}

function isParentChild(a, b) {
	const aParents = getParentNames(a);
	const bParents = getParentNames(b);
	const aName = normalizeLineageName(a.name);
	const bName = normalizeLineageName(b.name);

	const aIsParentOfB = bParents.includes(aName);
	const bIsParentOfA = aParents.includes(bName);

	return aIsParentOfB || bIsParentOfA;
}

function isGrandparentGrandchild(a, b) {
	const aGrandparents = getGrandparentNames(a);
	const bGrandparents = getGrandparentNames(b);
	const aName = normalizeLineageName(a.name);
	const bName = normalizeLineageName(b.name);

	return bGrandparents.includes(aName) || aGrandparents.includes(bName);
}

function isSibling(a, b) {
	return hasOverlap(getParentNames(a), getParentNames(b));
}

function isFullSibling(a, b) {
	const aParents = getParentNames(a);
	const bParents = getParentNames(b);
	if (aParents.length < 2 || bParents.length < 2) return false;
	const aSet = new Set(aParents);
	return bParents.every((p) => aSet.has(p));
}

function isRelated(a, b) {
	return hasOverlap(getAncestorNames(a), getAncestorNames(b));
}

function isUncleAunt(a, b) {
	const aParents = getParentNames(a);
	const bParents = getParentNames(b);
	const aGrandparents = getGrandparentNames(a);
	const bGrandparents = getGrandparentNames(b);
	return hasOverlap(aParents, bGrandparents) || hasOverlap(bParents, aGrandparents);
}

function getUncleAuntLabel(hovCat, other) {
	const hovParents = getParentNames(hovCat);
	const otherGrandparents = getGrandparentNames(other);
	const sex = other.sex?.toLowerCase();
	// If hovCat's parent is in other's grandparents, hovCat is the uncle/aunt → other is nephew/niece
	if (hasOverlap(hovParents, otherGrandparents)) {
		if (sex === 'female') return 'niece';
		if (sex === 'male') return 'nephew';
		return 'nephew/niece';
	}
	// Otherwise other is the uncle/aunt
	if (sex === 'female') return 'aunt';
	if (sex === 'male') return 'uncle';
	return 'uncle/aunt';
}

function getFamilySummary(cats) {
	const siblingCats = new Set();
	const parentChildCats = new Set();
	const grandparentChildCats = new Set();
	const distantCats = new Set();

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

function canBreed(a, b) {
	if (!a || !b || getCatId(a) === getCatId(b)) return false;
	const sa = a.sex?.toLowerCase();
	const sb = b.sex?.toLowerCase();
	if (!sa || !sb) return false;
	if (sa === 'herm' || sb === 'herm') return true;
	return sa !== sb;
}

function kinship(x, y, lookup, memo) {
	if (!x || !y) return 0;

	const nameX = normalizeLineageName(x.name);
	const nameY = normalizeLineageName(y.name);

	// Normalize order: older cat first (lower birthday = older)
	// If birthdays are equal or missing, use alphabetical as tiebreaker
	const bx = getCatBirthday(x) ?? Infinity;
	const by = getCatBirthday(y) ?? Infinity;
	let first = x,
		second = y,
		keyA = nameX,
		keyB = nameY;
	if (by < bx || (by === bx && nameY < nameX)) {
		first = y;
		second = x;
		keyA = nameY;
		keyB = nameX;
	}

	// When birthdays are tied/missing, prefer the cat with more known ancestors
	// as "second" (descendant) since we recurse through second's parents
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
	if (memo.has(key)) return memo.get(key);

	// Prevent infinite recursion while computing
	memo.set(key, 0);

	let result;
	if (keyA === keyB) {
		// Self-kinship: ψ(x,x) = 0.5(1 + f_x)
		const mother = lookup.get(normalizeLineageName(getCatGenealogyValue(first, 'parent1')));
		const father = lookup.get(normalizeLineageName(getCatGenealogyValue(first, 'parent2')));
		if (mother && father) {
			result = 0.5 * (1 + kinship(mother, father, lookup, memo));
		} else {
			result = 0.5; // Founder: assume not inbred
		}
	} else {
		// ψ(x,y) = 0.5(ψ(x, φ(y)) + ψ(x, ρ(y)))
		const motherY = lookup.get(normalizeLineageName(getCatGenealogyValue(second, 'parent1')));
		const fatherY = lookup.get(normalizeLineageName(getCatGenealogyValue(second, 'parent2')));
		if (!motherY && !fatherY) {
			result = 0; // y is a founder, unrelated
		} else {
			result = 0;
			if (motherY) result += 0.5 * kinship(first, motherY, lookup, memo);
			if (fatherY) result += 0.5 * kinship(first, fatherY, lookup, memo);
		}
	}

	memo.set(key, result);
	return result;
}

function createKinshipContext(allCats) {
	return { lookup: buildCatLookup(allCats), memo: new Map() };
}

function getInbreedingCoefficient(catX, catY, allCats, ctx) {
	const { lookup, memo } = ctx || createKinshipContext(allCats);
	return kinship(catX, catY, lookup, memo);
}

function getRoomInbreedingStats(roomCats, allCats) {
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
