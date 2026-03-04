import type { DownloadPayload, CatRecord } from '../../AppLogic.types.ts';

export type HeaderProps = {
	cats: CatRecord[];
	rooms: string[];
	dataTimeLineText: string;
	onUploadJson: (uploadedPayload: unknown, file?: File | null) => void;
	onUploadSav: (file: File) => void;
	onLoadDemo: () => void;
	onClearData: () => void;
	isDemoLoaded: boolean;
	savLoading: boolean;
	savError: string | null;
	downloadPayload: DownloadPayload;
};
