import type { ButtonDemoDataProps } from './ButtonDemoData.types.ts';
import './ButtonDemoData.css';

export function ButtonDemoData({ onLoadDemo, onClearData, isDemoLoaded }: ButtonDemoDataProps) {
	return (
		<div className="button-demo-data">
			<button onClick={onLoadDemo} className="button demo">
				📋 Demo File
			</button>
			{isDemoLoaded && (
				<button onClick={onClearData} className="button clear">
					✕
				</button>
			)}
		</div>
	);
}
