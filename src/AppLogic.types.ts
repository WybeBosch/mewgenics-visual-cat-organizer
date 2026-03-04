export type CatId = string | number;

export type TraitLabel = 'low' | 'average' | 'high';

export type CatStats = {
	STR: number;
	DEX: number;
	CON: number;
	INT: number;
	SPD: number;
	CHA: number;
	LCK: number;
};

export type CatAbilities = {
	active: Array<string | null>;
	passive: Array<string | null>;
	disorder: Array<string | null>;
};

export type CatGenealogy = {
	stray: boolean;
	parent1: string;
	parent2: string;
	grandparent1: string;
	grandparent2: string;
	grandparent3: string;
	grandparent4: string;
};

export type CatRecord = {
	key: number;
	id64: number;
	name: string;
	sex: string;
	age: number;
	level: number;
	class: string;
	retired: boolean;
	dead: boolean;
	donated: boolean;
	stats: CatStats;
	abilities: CatAbilities;
	mutations: Record<string, number>;
	icon: string;
	libido: TraitLabel;
	libido_raw: number;
	aggression: TraitLabel;
	aggression_raw: number;
	room: string;
	genealogy: CatGenealogy;
	_variant: string;
	_name_len: number;
	_name_end: number;
	_level_offset: number;
	_birth_day_offset: number;
	_stats_offset: number;
	_birth_day: number;
	loves: string;
	hates: string;
	id?: CatId;
	id64_str?: string;
	script_start_time?: string;
	LCK?: number;
};

export type MewgenicsCatsPayload = {
	basic: PayloadBasic;
	script_start_time: string;
	cats: CatRecord[];
};

export type PayloadBasic = {
	current_day: number;
};

export type PayloadMeta = {
	basic: PayloadBasic | null;
	script_start_time: string;
};

export type SourceType = 'preload-json' | 'upload-json' | 'upload-sav' | 'demo' | 'legacy-storage';

export type SourceMeta = {
	sourceType: SourceType;
	fileModifiedAt?: number | string;
	scriptStartTime?: number | string;
	loadedAt?: number | string;
};

export type DownloadPayload = {
	cats: CatRecord[];
	basic?: PayloadBasic;
	script_start_time?: string;
};

export type PersistedStorage = {
	payload?: unknown;
	cats?: unknown;
	payloadMeta?: Partial<PayloadMeta> | null;
	current_day?: unknown;
	script_start_time?: unknown;
	sourceMeta?: SourceMeta | null;
};

export type UnpackedPayload = {
	cats: CatRecord[];
	payloadMeta: PayloadMeta;
};

export const defaultPayloadMeta: PayloadMeta = { basic: null, script_start_time: '' };
