import type { Dispatch, SetStateAction } from 'react';
import type { CatId, CatRecord } from '../../AppLogic.types.ts';

export type HiddenLineType =
	| 'love'
	| 'hate'
	| 'parent'
	| 'grandparent'
	| 'sibling'
	| 'related'
	| 'inbreeding';

export type HiddenLineTypes = Set<HiddenLineType | string>;

export type GraphPosition = {
	name: string;
	sex?: unknown;
	x: number;
	y: number;
	nodeR?: number;
};

export type RelationshipGraphProps = {
	cats: CatRecord[];
	allCats: CatRecord[];
	hoveredCatId: CatId | null;
	setHoveredCatId: Dispatch<SetStateAction<CatId | null>>;
	activeRoom: string;
};

export type RelationshipSVGProps = {
	cats: CatRecord[];
	allCats: CatRecord[];
	hoveredCatId: CatId | null;
	setHoveredCatId: Dispatch<SetStateAction<CatId | null>>;
	hiddenLineTypes: HiddenLineTypes;
};

export type KinshipContext = {
	lookup: Map<string, CatRecord & { birthday?: unknown; parent1?: unknown; parent2?: unknown }>;
	memo: Map<string, number>;
};
