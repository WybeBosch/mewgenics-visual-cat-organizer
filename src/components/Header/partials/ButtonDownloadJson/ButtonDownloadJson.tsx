import type { ButtonDownloadJsonProps } from './ButtonDownloadJson.types.ts';
import './ButtonDownloadJson.css';

export function ButtonDownloadJson({ payload }: ButtonDownloadJsonProps) {
	return (
		<>
			<button
				className="button-download-json"
				onClick={() => {
					const dataStr = JSON.stringify(payload || { cats: [] }, null, 2);
					const blob = new Blob([dataStr], { type: 'application/json' });
					const url = URL.createObjectURL(blob);
					const anchor = document.createElement('a');
					anchor.href = url;
					anchor.download = 'mewgenics_cats.json';
					document.body.appendChild(anchor);
					anchor.click();
					document.body.removeChild(anchor);
					URL.revokeObjectURL(url);
				}}
			>
				{'⬇️ Download JSON'}
			</button>
		</>
	);
}
