export type ButtonUploadSaveProps = {
	onUploadSav?: (file: File) => void;
	savLoading: boolean;
	savError: string | null;
};
