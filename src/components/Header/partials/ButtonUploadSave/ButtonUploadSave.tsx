import { ButtonCopySavePath } from '../ButtonCopySavePath/ButtonCopySavePath.tsx';
import { SECURITY_LIMITS } from '../../../../shared/config/config.ts';
import { joinClass } from '../../../../shared/utils/utils.jsx';
import type { ButtonUploadSaveProps } from './ButtonUploadSave.types.ts';
import './ButtonUploadSave.css';

export function ButtonUploadSave({ onUploadSav, savLoading, savError }: ButtonUploadSaveProps) {
	const maxSaveUploadBytes = SECURITY_LIMITS.maxSaveUploadKb * 1024;
	const maxSaveSizeMb = Math.round(SECURITY_LIMITS.maxSaveUploadKb / 1024);
	return (
		<>
			<div className="upload-save-wrap">
				<label className={joinClass('upload-save', { loading: savLoading })}>
					<span role="img" aria-label="Save File" className="icon">
						{savLoading ? '⏳' : '💾'}
					</span>
					{savLoading ? 'Reading...' : 'Upload Save File'}
					<input
						type="file"
						accept=".sav"
						disabled={savLoading}
						className="input"
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) {
								if (!file.name.endsWith('.sav')) {
									alert('Please upload a .sav file for the database.');
								} else if (file.size > maxSaveUploadBytes) {
									alert(
										`Save file is too large. Max allowed size is ${maxSaveSizeMb} MB.`
									);
								} else {
									onUploadSav?.(file);
								}
							}
							event.target.value = '';
						}}
					/>
				</label>
				<ButtonCopySavePath />
			</div>
			{savError && <span className="upload-save-error">{savError}</span>}
		</>
	);
}
