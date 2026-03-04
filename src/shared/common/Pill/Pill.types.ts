import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type PillProps = {
	children: ReactNode;
	className?: string;
} & ComponentPropsWithoutRef<'span'>;
