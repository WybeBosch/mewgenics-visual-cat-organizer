import type { CatRecord, CatStats, TraitLabel } from '../../AppLogic.types.ts';
import type { CatLikeRecord, PayloadLikeRecord, UnknownRecord } from './catDataUtils.types.ts';

function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toStringValue(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value;
	if (value === null || value === undefined) return fallback;
	return String(value);
}

function toNumberValue(value: unknown, fallback = 0): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function toBooleanValue(value: unknown, fallback = false): boolean {
	if (typeof value === 'boolean') return value;
	return fallback;
}

function toTraitLabelValue(value: unknown, fallback: TraitLabel = 'average'): TraitLabel {
	if (typeof value !== 'string') return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'low') return 'low';
	if (normalized === 'average' || normalized === 'avg' || normalized === 'medium') {
		return 'average';
	}
	if (normalized === 'high') return 'high';
	return fallback;
}

function asPayloadLike(value: unknown): PayloadLikeRecord | null {
	if (!isRecord(value)) return null;
	return value as PayloadLikeRecord;
}

function asCatLike(value: unknown): CatLikeRecord | null {
	if (!isRecord(value)) return null;
	return value as CatLikeRecord;
}

function normalizeStats(value: unknown): CatStats {
	const stats = isRecord(value) ? value : {};
	return {
		STR: toNumberValue(stats.STR),
		DEX: toNumberValue(stats.DEX),
		CON: toNumberValue(stats.CON),
		INT: toNumberValue(stats.INT),
		SPD: toNumberValue(stats.SPD),
		CHA: toNumberValue(stats.CHA),
		LCK: toNumberValue(stats.LCK),
	};
}

function normalizeStringList(value: unknown): Array<string | null> {
	if (!Array.isArray(value)) return [];
	return value.map((item) => (item === null ? null : toStringValue(item, '')));
}

function normalizeMutations(value: unknown): Record<string, number> {
	if (!isRecord(value)) return {};
	return Object.fromEntries(
		Object.entries(value).map(([key, mutationValue]) => [key, toNumberValue(mutationValue)])
	);
}

function normalizeTraitRaw(value: unknown, traitLabel: TraitLabel): number {
	const parsed = toTraitScore(value);
	if (parsed !== null) return parsed;
	if (traitLabel === 'low') return 1 / 6;
	if (traitLabel === 'average') return 0.5;
	return 5 / 6;
}

function normalizeCatRecord(value: unknown): CatRecord {
	const cat = asCatLike(value) ?? {};
	const libidoLabel = toTraitLabelValue(cat.libido);
	const aggressionLabel = toTraitLabelValue(cat.aggression);
	const genealogy: UnknownRecord = isRecord(cat.genealogy) ? cat.genealogy : {};
	const abilities: UnknownRecord = isRecord(cat.abilities) ? cat.abilities : {};

	return {
		key: toNumberValue(cat.key),
		id64: toNumberValue(cat.id64),
		name: toStringValue(cat.name),
		sex: toStringValue(cat.sex),
		age: toNumberValue(cat.age),
		level: toNumberValue(cat.level),
		class: toStringValue(cat.class),
		retired: toBooleanValue(cat.retired),
		dead: toBooleanValue(cat.dead),
		donated: toBooleanValue(cat.donated),
		stats: normalizeStats(cat.stats),
		abilities: {
			active: normalizeStringList(abilities.active),
			passive: normalizeStringList(abilities.passive),
			disorder: normalizeStringList(abilities.disorder),
		},
		mutations: normalizeMutations(cat.mutations),
		icon: toStringValue(cat.icon),
		libido: libidoLabel,
		libido_raw: normalizeTraitRaw(cat.libido_raw, libidoLabel),
		aggression: aggressionLabel,
		aggression_raw: normalizeTraitRaw(cat.aggression_raw, aggressionLabel),
		room: toStringValue(cat.room),
		genealogy: {
			stray: toBooleanValue(genealogy.stray),
			parent1: toStringValue(genealogy.parent1),
			parent2: toStringValue(genealogy.parent2),
			grandparent1: toStringValue(genealogy.grandparent1),
			grandparent2: toStringValue(genealogy.grandparent2),
			grandparent3: toStringValue(genealogy.grandparent3),
			grandparent4: toStringValue(genealogy.grandparent4),
		},
		_variant: toStringValue(cat._variant),
		_name_len: toNumberValue(cat._name_len),
		_name_end: toNumberValue(cat._name_end),
		_level_offset: toNumberValue(cat._level_offset),
		_birth_day_offset: toNumberValue(cat._birth_day_offset),
		_stats_offset: toNumberValue(cat._stats_offset),
		_birth_day: toNumberValue(cat._birth_day ?? cat.birthday),
		loves: toStringValue(cat.loves),
		hates: toStringValue(cat.hates),
		id: cat.id !== undefined ? toStringValue(cat.id) : undefined,
		id64_str: cat.id64_str !== undefined ? toStringValue(cat.id64_str) : undefined,
		script_start_time:
			cat.script_start_time !== undefined ? toStringValue(cat.script_start_time) : undefined,
		LCK: cat.LCK !== undefined ? toNumberValue(cat.LCK) : undefined,
	};
}

function getCatsFromPayload(payload: unknown): CatRecord[] {
	if (Array.isArray(payload)) return payload.map((cat) => normalizeCatRecord(cat));

	const payloadLike = asPayloadLike(payload);
	if (!payloadLike || !Array.isArray(payloadLike.cats)) return [];

	return payloadLike.cats.map((cat) => normalizeCatRecord(cat));
}

function getCurrentDayFromPayload(payload: unknown): number | null {
	const payloadLike = asPayloadLike(payload);
	if (!payloadLike) return null;
	const basic = payloadLike.basic;
	if (!isRecord(basic)) return null;
	const currentDay = basic.current_day;
	return typeof currentDay === 'number' ? currentDay : null;
}

function getScriptStartTimeFromPayload(payload: unknown, cats: CatRecord[] = []): string {
	const payloadLike = asPayloadLike(payload);
	if (payloadLike && typeof payloadLike.script_start_time === 'string') {
		return payloadLike.script_start_time;
	}
	const firstCatScriptStart = cats[0]?.script_start_time;
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
		}
		if (typeof catLike.LCK === 'number') return catLike.LCK;
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
