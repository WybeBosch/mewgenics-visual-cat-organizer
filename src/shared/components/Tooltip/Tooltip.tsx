import { useState } from 'react';
import { joinClass } from '../../utils/utils.tsx';
import type { TooltipPanelProps, TooltipProps } from './Tooltip.types.ts';
import './Tooltip.css';

function TooltipPanel({ children, position = 'below', align = 'center', interactive, className, style }: TooltipPanelProps) {
	return (
		<div className={joinClass('tooltip-panel', position, align, { interactive }, className)} style={style}>
			{children}
		</div>
	);
}

function Tooltip({ content, children, position = 'below', align = 'center' }: TooltipProps) {
	const [show, setShow] = useState(false);

	return (
		<span className="tooltip-anchor" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
			{children}
			{show && (
				<TooltipPanel position={position} align={align}>
					{content}
				</TooltipPanel>
			)}
		</span>
	);
}

export { Tooltip, TooltipPanel };
