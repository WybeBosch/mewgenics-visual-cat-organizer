import type { PillProps } from './Pill.types.ts';
import './Pill.css';

export function Pill({ children, className = '', ...rest }: PillProps) {
	return (
		<div className="warning-pill">
			<span className={`badge${className ? ` ${className}` : ''}`} {...rest}>
				{children}
			</span>
		</div>
	);
}

export default Pill;
