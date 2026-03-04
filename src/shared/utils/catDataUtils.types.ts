import type { CatRecord, MewgenicsCatsPayload, TraitLabel } from '../../AppLogic.types.ts';

export type UnknownRecord = Record<string, unknown>;

export type CatLikeRecord = Partial<CatRecord> & UnknownRecord;

export type PayloadLikeRecord = Partial<MewgenicsCatsPayload> & UnknownRecord;

export type TraitLabelLike = TraitLabel | string;
