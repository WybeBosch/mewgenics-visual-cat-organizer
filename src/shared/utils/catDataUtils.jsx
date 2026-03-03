function getCatsFromPayload(payload) {
	if (Array.isArray(payload)) return payload;
	if (!payload || typeof payload !== 'object') return [];
	return Array.isArray(payload.cats) ? payload.cats : [];
}

function getCurrentDayFromPayload(payload) {
	if (!payload || typeof payload !== 'object') return null;
	const currentDay = payload.basic?.current_day;
	return typeof currentDay === 'number' ? currentDay : null;
}

function getScriptStartTimeFromPayload(payload, cats = []) {
	if (payload && typeof payload === 'object' && typeof payload.script_start_time === 'string') {
		return payload.script_start_time;
	}
	const firstCatScriptStart = cats[0]?.script_start_time;
	return typeof firstCatScriptStart === 'string' ? firstCatScriptStart : '';
}

function getCatId(cat, fallback = '') {
	if (!cat || typeof cat !== 'object') return fallback;
	if (cat.id !== null && cat.id !== undefined && cat.id !== '') return String(cat.id);
	if (cat.key !== null && cat.key !== undefined && cat.key !== '') return String(cat.key);
	if (cat.id64 !== null && cat.id64 !== undefined && cat.id64 !== '') return String(cat.id64);
	if (cat.name) return String(cat.name).toLowerCase().replace(/\s+/g, '-');
	return fallback;
}

function getCatSex(cat) {
	return String(cat?.sex || '').toLowerCase();
}

function getCatStat(cat, statKey) {
	if (!cat || typeof cat !== 'object') return 0;
	const nestedStats = cat.stats && typeof cat.stats === 'object' ? cat.stats : null;

	if (statKey === 'LCK') {
		if (nestedStats) {
			if (typeof nestedStats.LCK === 'number') return nestedStats.LCK;
			if (typeof nestedStats.LUCK === 'number') return nestedStats.LUCK;
		}
		if (typeof cat.LCK === 'number') return cat.LCK;
		if (typeof cat.LUCK === 'number') return cat.LUCK;
		return 0;
	}

	if (nestedStats && typeof nestedStats[statKey] === 'number') return nestedStats[statKey];
	if (typeof cat[statKey] === 'number') return cat[statKey];
	return 0;
}

function getCatGenealogy(cat) {
	if (!cat || typeof cat !== 'object') return {};
	return cat.genealogy && typeof cat.genealogy === 'object' ? cat.genealogy : cat;
}

function getCatGenealogyValue(cat, key) {
	const genealogy = getCatGenealogy(cat);
	return genealogy?.[key] || '';
}

function getCatBirthday(cat) {
	if (typeof cat?.birthday === 'number') return cat.birthday;
	if (typeof cat?._birth_day === 'number') return cat._birth_day;
	return null;
}

function getAge(cat) {
	return typeof cat?.age === 'number' ? cat.age : null;
}

function isKitten(cat) {
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
	isKitten,
};
