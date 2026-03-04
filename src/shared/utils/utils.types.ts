import type { CatRecord } from '../../AppLogic.types.ts';
import type { CSSProperties } from 'react';

export type ClassInputPrimitive = string | number | false | null | undefined;

export type ClassInputObject = Record<string, unknown>;

export type ClassInput = ClassInputPrimitive | ClassInputObject | ClassInput[];

export type TooltipLine = {
	label: string;
	value: string;
};

export type TableTooltipPopupProps = {
	cat: CatRecord;
	allCats: CatRecord[];
};

export type TooltipPosition = {
	x: number;
	y: number;
};

export type TooltipStyle = CSSProperties & {
	'--tooltip-top': string;
	'--tooltip-left': string;
};

declare global {
	interface Window {
		enableLogging?: boolean;
	}
}
