import type { CSSProperties, ReactNode } from 'react';

export type TooltipPosition = 'above' | 'below';
export type TooltipAlign = 'left' | 'center' | 'right';

export type TooltipPanelProps = {
	children: ReactNode;
	position?: TooltipPosition;
	align?: TooltipAlign;
	interactive?: boolean;
	className?: string;
	style?: CSSProperties;
};

export type TooltipProps = {
	content: ReactNode;
	children: ReactNode;
	position?: TooltipPosition;
	align?: TooltipAlign;
};
