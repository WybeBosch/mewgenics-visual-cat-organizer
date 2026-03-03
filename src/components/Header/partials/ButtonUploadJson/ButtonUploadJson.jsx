import { SECURITY_LIMITS } from '../../../../shared/config/config.jsx';
import './ButtonUploadJson.css';

export function ButtonUploadJson({ onUploadJson }) {
	const maxJsonUploadBytes = SECURITY_LIMITS.maxJsonUploadKb * 1024;
	const maxJsonSizeMb = Math.round(SECURITY_LIMITS.maxJsonUploadKb / 1024);
	return (
		<>
			<label className="button-upload-json">
				<span role="img" aria-label="Upload" className="icon">
					⬆️
				</span>{' '}
				Upload JSON
				<input
					type="file"
					accept=".json,application/json"
					className="input"
					onChange={async (e) => {
						const file = e.target.files && e.target.files[0];
						if (!file) return;
						if (!file.name.endsWith('.json')) {
							alert('Please upload a .json file for the JSON button.');
							e.target.value = '';
							return;
						}
						if (file.size > maxJsonUploadBytes) {
							alert(
								`JSON file is too large. Max allowed size is ${maxJsonSizeMb} MB.`
							);
							e.target.value = '';
							return;
						}
						try {
							const text = await file.text();
							const data = JSON.parse(text);
							const isArrayPayload = Array.isArray(data);
							const hasCatsArray = !isArrayPayload && Array.isArray(data?.cats);
							if (!isArrayPayload && !hasCatsArray) {
								alert(
									'Invalid JSON shape. Expected an array or an object with a cats array.'
								);
								e.target.value = '';
								return;
							}
							if (onUploadJson) onUploadJson(data, file);
						} catch {
							alert('Invalid JSON file.');
						}
						e.target.value = '';
					}}
				/>
			</label>
		</>
	);
}
