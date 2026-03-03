import './ButtonDownloadJson.css';

export function ButtonDownloadJson({ payload }) {
	return (
		<>
			<button
				className="button-download-json"
				onClick={() => {
					const dataStr = JSON.stringify(payload || { cats: [] }, null, 2);
					const blob = new Blob([dataStr], { type: 'application/json' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = 'mewgenics_cats.json';
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
					URL.revokeObjectURL(url);
				}}
			>
				{'⬇️ Download JSON'}
			</button>
		</>
	);
}
