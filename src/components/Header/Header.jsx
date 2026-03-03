import { Heading } from './partials/Heading/Heading';
import { ButtonUploadSave } from './partials/ButtonUploadSave/ButtonUploadSave';
import { ButtonUploadJson } from './partials/ButtonUploadJson/ButtonUploadJson';
import { ButtonDownloadJson } from './partials/ButtonDownloadJson/ButtonDownloadJson';
import { ButtonDemoData } from './partials/ButtonDemoData/ButtonDemoData';
import './Header.css';

export function Header({
	cats,
	rooms,
	dataTimeLineText,
	onUploadJson,
	onUploadSav,
	onLoadDemo,
	onClearData,
	isDemoLoaded,
	savLoading,
	savError,
	downloadPayload,
}) {
	return (
		<>
			<header className="header">
				<Heading cats={cats} rooms={rooms} dataTimeLineText={dataTimeLineText} />
				<div className="button-bar">
					<ButtonUploadSave
						onUploadSav={onUploadSav}
						savLoading={savLoading}
						savError={savError}
					/>
					<div className="upload-json-wrap">
						<ButtonUploadJson onUploadJson={onUploadJson} />
						<ButtonDemoData
							onLoadDemo={onLoadDemo}
							onClearData={onClearData}
							isDemoLoaded={isDemoLoaded}
						/>
					</div>
					<ButtonDownloadJson payload={downloadPayload} />
				</div>
			</header>
		</>
	);
}
