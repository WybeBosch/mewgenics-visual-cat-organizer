import type { CatLikeRecord, UnknownRecord } from './catDataUtils.types.ts';

function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asCatLike(value: unknown): CatLikeRecord | null {
	if (!isRecord(value)) return null;
	return value as CatLikeRecord;
}

function getCatsFromPayload(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload;
	if (!isRecord(payload)) return [];
	return Array.isArray(payload.cats) ? payload.cats : [];
}

function getCurrentDayFromPayload(payload: unknown): number | null {
	if (!isRecord(payload)) return null;
	const basic = payload.basic;
	if (!isRecord(basic)) return null;
	const currentDay = basic.current_day;
	return typeof currentDay === 'number' ? currentDay : null;
}

function getScriptStartTimeFromPayload(payload: unknown, cats: unknown[] = []): string {
	if (isRecord(payload) && typeof payload.script_start_time === 'string') {
		return payload.script_start_time;
	}
	const firstCat = asCatLike(cats[0]);
	const firstCatScriptStart = firstCat?.script_start_time;
	return typeof firstCatScriptStart === 'string' ? firstCatScriptStart : '';
}

function getCatId(cat: unknown, fallback = ''): string {
	const catLike = asCatLike(cat);
	if (!catLike) return fallback;

	const idCandidates = [catLike.id, catLike.key, catLike.id64];
	for (const candidate of idCandidates) {
		if (candidate !== null && candidate !== undefined && candidate !== '') {
			return String(candidate);
		}
	}

	if (catLike.name) return String(catLike.name).toLowerCase().replace(/\s+/g, '-');
	return fallback;
}

function getCatSex(cat: unknown): string {
	const catLike = asCatLike(cat);
	return String(catLike?.sex || '').toLowerCase();
}

function getCatStat(cat: unknown, statKey: string): number {
	const catLike = asCatLike(cat);
	if (!catLike) return 0;

	const nestedStats = isRecord(catLike.stats) ? catLike.stats : null;

	if (statKey === 'LCK') {
		if (nestedStats) {
			if (typeof nestedStats.LCK === 'number') return nestedStats.LCK;
			if (typeof nestedStats.LUCK === 'number') return nestedStats.LUCK;
		}
		if (typeof catLike.LCK === 'number') return catLike.LCK;
		if (typeof catLike.LUCK === 'number') return catLike.LUCK;
		return 0;
	}

	if (nestedStats && typeof nestedStats[statKey] === 'number') return nestedStats[statKey];
	if (typeof catLike[statKey] === 'number') return catLike[statKey];
	return 0;
}

function getCatGenealogy(cat: unknown): UnknownRecord {
	const catLike = asCatLike(cat);
	if (!catLike) return {};
	return isRecord(catLike.genealogy) ? catLike.genealogy : catLike;
}

function getCatGenealogyValue(cat: unknown, key: string): unknown {
	const genealogy = getCatGenealogy(cat);
	return genealogy[key] || '';
}

function getCatBirthday(cat: unknown): number | null {
	const catLike = asCatLike(cat);
	if (!catLike) return null;
	if (typeof catLike.birthday === 'number') return catLike.birthday;
	if (typeof catLike._birth_day === 'number') return catLike._birth_day;
	return null;
}

function getAge(cat: unknown): number | null {
	const catLike = asCatLike(cat);
	return typeof catLike?.age === 'number' ? catLike.age : null;
}

function normalizeTraitScore(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value <= 1) return value;
	if (value <= 9) return value / 9;
	if (value <= 100) return value / 100;
	return 1;
}

function toTraitScore(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return normalizeTraitScore(value);
	}
	if (typeof value === 'string') {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) return normalizeTraitScore(parsed);
	}
	return null;
}

function toTraitLabel(value: unknown): 'low' | 'average' | 'high' | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'low') return 'low';
	if (normalized === 'average' || normalized === 'avg' || normalized === 'medium') {
		return 'average';
	}
	if (normalized === 'high') return 'high';
	return null;
}

function getAggressionScore(cat: unknown): number | null {
	const catLike = asCatLike(cat);
	if (!catLike) return null;

	const rawScore = toTraitScore(catLike.aggression_raw);
	if (rawScore !== null) return rawScore;

	const numericAggression = toTraitScore(catLike.aggression);
	if (numericAggression !== null) return numericAggression;

	const aggressionLabel = toTraitLabel(catLike.aggression);
	if (aggressionLabel === 'low') return 1 / 6;
	if (aggressionLabel === 'average') return 0.5;
	if (aggressionLabel === 'high') return 5 / 6;

	return null;
}

function getAggressionLabel(cat: unknown): 'low' | 'average' | 'high' {
	const catLike = asCatLike(cat);
	const labelFromField = toTraitLabel(catLike?.aggression);
	if (labelFromField) return labelFromField;

	const score = getAggressionScore(cat);
	if (score === null) return 'average';
	if (score < 1 / 3) return 'low';
	if (score < 2 / 3) return 'average';
	return 'high';
}

function getLibidoScore(cat: unknown): number | null {
	const catLike = asCatLike(cat);
	if (!catLike) return null;

	const rawScore = toTraitScore(catLike.libido_raw);
	if (rawScore !== null) return rawScore;

	const numericLibido = toTraitScore(catLike.libido);
	if (numericLibido !== null) return numericLibido;

	const libidoLabel = toTraitLabel(catLike.libido);
	if (libidoLabel === 'low') return 1 / 6;
	if (libidoLabel === 'average') return 0.5;
	if (libidoLabel === 'high') return 5 / 6;

	return null;
}

function getLibidoLabel(cat: unknown): 'low' | 'average' | 'high' {
	const catLike = asCatLike(cat);
	const labelFromField = toTraitLabel(catLike?.libido);
	if (labelFromField) return labelFromField;

	const score = getLibidoScore(cat);
	if (score === null) return 'average';
	if (score < 1 / 3) return 'low';
	if (score < 2 / 3) return 'average';
	return 'high';
}

function isKitten(cat: unknown): boolean {
	const age = getAge(cat);
	return age === null || age <= 1;
}

export {
	getCatsFromPayload,
	getCurrentDayFromPayload,
	getScriptStartTimeFromPayload,
	getCatId,
	getCatSex,
	getCatStat,
	getCatGenealogy,
	getCatGenealogyValue,
	getCatBirthday,
	getAge,
	getAggressionScore,
	getAggressionLabel,
	getLibidoScore,
	getLibidoLabel,
	isKitten,
};
