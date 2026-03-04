import type { CatRecord } from '../../../../../AppLogic.types.ts';
import type { KinshipContext } from '../../../RelationshipGraph.types.ts';

export type RelatedCat = CatRecord & {
	birthday?: unknown;
	parent1?: unknown;
	parent2?: unknown;
};

export type RelatedPosition = {
	name: string;
	x: number;
	y: number;
	nodeR?: number;
};

export type FamilySummary = {
	siblings: number;
	parentChild: number;
	grandparentChild: number;
	distantlyRelated: number;
	hasFamily: boolean;
};

export type RoomInbreedingStats = {
	totalPairs: number;
	riskyPairs: number;
};

export type CatLookup = Map<string, RelatedCat>;

export type RelationKinshipContext = KinshipContext;
