import { useState, useEffect, useCallback, useMemo } from 'react';

import { logIfEnabled } from './shared/utils/utils.tsx';
import {
	getCatsFromPayload,
	getCurrentDayFromPayload,
	getScriptStartTimeFromPayload,
} from './shared/utils/catDataUtils.ts';
import {
	defaultPayloadMeta,
	type CatId,
	type CatRecord,
	type DownloadPayload,
	type PayloadMeta,
	type PersistedStorage,
	type SourceMeta,
	type SourceType,
	type UnpackedPayload,
} from './AppLogic.types.ts';

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function isPayloadObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function useMewgenicsCatsLogic() {
	const [cats, setCats] = useState<CatRecord[]>([]);
	const [sourceMeta, setSourceMeta] = useState<SourceMeta | null>(null);
	const [activeRoom, setActiveRoom] = useState('');
	const [loaded, setLoaded] = useState(false);
	const [savLoading, setSavLoading] = useState(false);
	const [savError, setSavError] = useState<string | null>(null);
	const [hoveredCatId, setHoveredCatId] = useState<CatId | null>(null);
	const [payloadMeta, setPayloadMeta] = useState<PayloadMeta>(defaultPayloadMeta);

	const unpackPayload = useCallback((payloadLike: unknown): UnpackedPayload => {
		const unpackedCats = getCatsFromPayload(payloadLike);
		const currentDay = getCurrentDayFromPayload(payloadLike);
		const scriptStartTime = getScriptStartTimeFromPayload(payloadLike, unpackedCats);
		return {
			cats: unpackedCats,
			payloadMeta: {
				basic: typeof currentDay === 'number' ? { current_day: currentDay } : null,
				script_start_time: typeof scriptStartTime === 'string' ? scriptStartTime : '',
			},
		};
	}, []);

	const formatDateText = useCallback((value: unknown) => {
		if (value === null || value === undefined || value === '') return '';

		const parsedValue =
			typeof value === 'number'
				? value
				: typeof value === 'string' && /^\d+$/.test(value)
					? Number(value)
					: value;

		const date = new Date(parsedValue as string | number | Date);
		if (Number.isNaN(date.getTime())) return String(value);
		return date.toLocaleString();
	}, []);

	const getSourceMetaDateText = useCallback(
		(meta: SourceMeta | null) => {
			if (!meta) return 'Loaded now';

			const fileDateText = formatDateText(meta.fileModifiedAt);
			if (fileDateText) return fileDateText;

			const scriptDateText = formatDateText(meta.scriptStartTime);
			if (scriptDateText) return scriptDateText;

			const loadedDateText = formatDateText(meta.loadedAt);
			if (loadedDateText) return loadedDateText;

			return 'Loaded now';
		},
		[formatDateText]
	);

	const getSourceLabel = useCallback((sourceType: SourceType | undefined) => {
		switch (sourceType) {
			case 'preload-json':
				return '[local .JSON]';
			case 'upload-json':
				return '[.JSON]';
			case 'upload-sav':
				return '[.SAV]';
			case 'demo':
				return '[Demo]';
			default:
				return '[data]';
		}
	}, []);

	const dataTimeLineText =
		cats.length === 0
			? 'No data loaded yet'
			: `${getSourceLabel(sourceMeta?.sourceType)} - Data Time: ${getSourceMetaDateText(sourceMeta)}`;

	const downloadPayload = useMemo<DownloadPayload>(() => {
		const payload: DownloadPayload = { cats };
		if (
			payloadMeta?.basic?.current_day !== undefined &&
			payloadMeta?.basic?.current_day !== null
		) {
			payload.basic = payloadMeta.basic;
		}
		if (payloadMeta?.script_start_time) {
			payload.script_start_time = payloadMeta.script_start_time;
		}
		return payload;
	}, [cats, payloadMeta]);

	const rooms = useMemo(() => Array.from(new Set(cats.map((cat) => cat.room))), [cats]);

	useEffect(() => {
		if (!rooms.includes(activeRoom)) setActiveRoom(rooms[0] || '');
	}, [activeRoom, rooms]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			let jsonCats: CatRecord[] = [];
			let jsonPayloadMeta: PayloadMeta = defaultPayloadMeta;
			let jsonSourceMeta: SourceMeta | null = null;
			let storageCats: CatRecord[] = [];
			let storagePayloadMeta: PayloadMeta = defaultPayloadMeta;
			let storageSourceMeta: SourceMeta | null = null;
			let storageFound: boolean;

			try {
				const isLocalDevelopment = import.meta.env.DEV;
				if (isLocalDevelopment) {
					const preloadJsonUrl = `${import.meta.env.BASE_URL}mewgenics_cats.json`;
					const response = await fetch(preloadJsonUrl, { cache: 'no-store' });
					if (!response.ok) {
						if (response.status !== 404) {
							logIfEnabled(
								`[cats] preload fetch failed: ${response.status} ${response.statusText}`
							);
						}
						throw new Error('No preload JSON found');
					}
					const data = (await response.json()) as unknown;
					const unpacked = unpackPayload(data);
					jsonCats = unpacked.cats;
					jsonPayloadMeta = unpacked.payloadMeta;
					jsonSourceMeta = {
						sourceType: 'preload-json',
						scriptStartTime: unpacked.payloadMeta.script_start_time,
						loadedAt: new Date().toISOString(),
					};
				}
			} catch (error) {
				logIfEnabled('[cats] optional preload JSON not used:', getErrorMessage(error));
			}

			try {
				const storageRaw = window.localStorage.getItem('mewgenics-v14');
				storageFound = storageRaw !== null;
				if (storageRaw !== null) {
					const parsed = JSON.parse(storageRaw) as PersistedStorage;
					if (isPayloadObject(parsed?.payload)) {
						const unpacked = unpackPayload(parsed.payload);
						storageCats = unpacked.cats;
						storagePayloadMeta = unpacked.payloadMeta;
					} else {
						storageCats = getCatsFromPayload({ cats: parsed?.cats });
						storagePayloadMeta = {
							basic:
								typeof parsed?.payloadMeta?.basic?.current_day === 'number'
									? {
											current_day: parsed.payloadMeta.basic.current_day,
										}
									: typeof parsed?.current_day === 'number'
										? { current_day: parsed.current_day }
										: null,
							script_start_time:
								typeof parsed?.payloadMeta?.script_start_time === 'string'
									? parsed.payloadMeta.script_start_time
									: typeof parsed?.script_start_time === 'string'
										? parsed.script_start_time
										: typeof storageCats[0]?.script_start_time === 'string'
											? storageCats[0].script_start_time
											: '',
						};
					}

					storageSourceMeta = parsed?.sourceMeta || null;
					if (!storageSourceMeta) {
						storageSourceMeta = {
							sourceType: 'legacy-storage',
							scriptStartTime: storagePayloadMeta.script_start_time,
							loadedAt: new Date().toISOString(),
						};
					}
				}
			} catch {
				storageFound = false;
			}

			const isLocalDevelopment = import.meta.env.DEV;
			const hasPreloadJson = jsonCats.length > 0;
			const useJson =
				(isLocalDevelopment && hasPreloadJson) || (!storageFound && hasPreloadJson);

			const mergedCats = useJson ? jsonCats : storageCats;
			if (!cancelled) {
				logIfEnabled('[cats] mergedCats:', mergedCats);
				setCats(mergedCats);
				setPayloadMeta(useJson ? jsonPayloadMeta : storagePayloadMeta);
				setSourceMeta(useJson ? jsonSourceMeta : storageSourceMeta);
				setLoaded(true);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [unpackPayload]);

	useEffect(() => {
		if (!loaded) return;
		try {
			const payload: DownloadPayload = { cats };
			if (
				payloadMeta?.basic?.current_day !== undefined &&
				payloadMeta?.basic?.current_day !== null
			) {
				payload.basic = payloadMeta.basic;
			}
			if (payloadMeta?.script_start_time) {
				payload.script_start_time = payloadMeta.script_start_time;
			}
			window.localStorage.setItem(
				'mewgenics-v14',
				JSON.stringify({ payload, cats, payloadMeta, sourceMeta })
			);
			logIfEnabled('[cats] saved to localStorage:', cats);
		} catch (error) {
			logIfEnabled('[cats] failed to save localStorage:', error);
		}
	}, [cats, loaded, payloadMeta, sourceMeta]);

	const handleUploadSav = useCallback(
		async (file: File) => {
			setSavLoading(true);
			setSavError(null);
			try {
				const { extractSaveFile } =
					await import('./data-grabber/python/extractSaveFile.ts');
				const payload = await extractSaveFile(file);
				const unpacked = unpackPayload(payload);
				const extractedCats = unpacked.cats;
				if (!extractedCats.length) {
					setSavError('No housed cats found in save file.');
					return;
				}
				const nextSourceMeta: SourceMeta = {
					sourceType: 'upload-sav',
					fileModifiedAt: typeof file.lastModified === 'number' ? file.lastModified : '',
					scriptStartTime: unpacked.payloadMeta.script_start_time,
					loadedAt: new Date().toISOString(),
				};
				const nextPayloadMeta = unpacked.payloadMeta;
				setCats(extractedCats);
				setPayloadMeta(nextPayloadMeta);
				setSourceMeta(nextSourceMeta);
				setLoaded(true);
				setActiveRoom([...new Set(extractedCats.map((cat) => cat.room))][0] || '');
				try {
					const persistedPayload: DownloadPayload = { cats: extractedCats };
					if (nextPayloadMeta.basic) persistedPayload.basic = nextPayloadMeta.basic;
					if (nextPayloadMeta.script_start_time) {
						persistedPayload.script_start_time = nextPayloadMeta.script_start_time;
					}
					window.localStorage.setItem(
						'mewgenics-v14',
						JSON.stringify({
							payload: persistedPayload,
							cats: extractedCats,
							payloadMeta: nextPayloadMeta,
							sourceMeta: nextSourceMeta,
						})
					);
					logIfEnabled('[sav] saved extractedCats:', extractedCats);
				} catch (error) {
					logIfEnabled('[sav] failed to save extractedCats:', error);
				}
			} catch (error) {
				logIfEnabled('[extractSaveFile] Error:', error);
				setSavError(`Error reading save file: ${getErrorMessage(error)}`);
			} finally {
				setSavLoading(false);
			}
		},
		[unpackPayload]
	);

	const handleLoadDemo = useCallback(async () => {
		try {
			const demoUrl = `${import.meta.env.BASE_URL}demo_mewgenics_cats.json`;
			const response = await fetch(demoUrl, { cache: 'no-store' });
			if (!response.ok) throw new Error(`Failed to fetch demo data: ${response.status}`);
			const data = (await response.json()) as unknown;
			const unpacked = unpackPayload(data);
			const demoCats = unpacked.cats;
			if (!demoCats.length) return;
			const nextSourceMeta: SourceMeta = {
				sourceType: 'demo',
				scriptStartTime: unpacked.payloadMeta.script_start_time,
				loadedAt: new Date().toISOString(),
			};
			setCats(demoCats);
			setPayloadMeta(unpacked.payloadMeta);
			setSourceMeta(nextSourceMeta);
			setLoaded(true);
			setActiveRoom([...new Set(demoCats.map((cat) => cat.room))][0] || '');
			try {
				const persistedPayload: DownloadPayload = { cats: demoCats };
				if (unpacked.payloadMeta.basic) persistedPayload.basic = unpacked.payloadMeta.basic;
				if (unpacked.payloadMeta.script_start_time) {
					persistedPayload.script_start_time = unpacked.payloadMeta.script_start_time;
				}
				window.localStorage.setItem(
					'mewgenics-v14',
					JSON.stringify({
						payload: persistedPayload,
						cats: demoCats,
						payloadMeta: unpacked.payloadMeta,
						sourceMeta: nextSourceMeta,
					})
				);
				logIfEnabled('[demo] loaded demo cats:', demoCats);
			} catch (error) {
				logIfEnabled('[demo] failed to save demo cats:', error);
			}
		} catch (error) {
			logIfEnabled('[demo] Error loading demo data:', error);
			alert('Failed to load demo data.');
		}
	}, [unpackPayload]);

	const handleClearData = useCallback(() => {
		setCats([]);
		setSourceMeta(null);
		setPayloadMeta(defaultPayloadMeta);
		setActiveRoom('');
		try {
			window.localStorage.removeItem('mewgenics-v14');
			logIfEnabled('[clear] cleared all data and localStorage');
		} catch (error) {
			logIfEnabled('[clear] failed to clear localStorage:', error);
		}
	}, []);

	const handleUploadJson = useCallback(
		(uploadedPayload: unknown, file?: File | null) => {
			const unpacked = unpackPayload(uploadedPayload);
			const uploadedCats = unpacked.cats;
			const nextSourceMeta: SourceMeta = {
				sourceType: 'upload-json',
				fileModifiedAt: typeof file?.lastModified === 'number' ? file.lastModified : '',
				scriptStartTime: unpacked.payloadMeta.script_start_time,
				loadedAt: new Date().toISOString(),
			};
			setCats(uploadedCats);
			setPayloadMeta(unpacked.payloadMeta);
			setSourceMeta(nextSourceMeta);
			setLoaded(true);
			const newRooms = [...new Set(uploadedCats.map((cat) => cat.room))];
			setActiveRoom(newRooms[0] || '');
			try {
				const persistedPayload: DownloadPayload = { cats: uploadedCats };
				if (unpacked.payloadMeta.basic) persistedPayload.basic = unpacked.payloadMeta.basic;
				if (unpacked.payloadMeta.script_start_time) {
					persistedPayload.script_start_time = unpacked.payloadMeta.script_start_time;
				}
				window.localStorage.setItem(
					'mewgenics-v14',
					JSON.stringify({
						payload: persistedPayload,
						cats: uploadedCats,
						payloadMeta: unpacked.payloadMeta,
						sourceMeta: nextSourceMeta,
					})
				);
				logIfEnabled('[json] saved uploadedCats:', uploadedCats);
			} catch (error) {
				logIfEnabled('[json] failed to save uploadedCats:', error);
			}
		},
		[unpackPayload]
	);

	return {
		cats,
		setCats,
		rooms,
		activeRoom,
		setActiveRoom,
		dataTimeLineText,
		loaded,
		savLoading,
		savError,
		hoveredCatId,
		setHoveredCatId,
		handleUploadSav,
		handleUploadJson,
		handleLoadDemo,
		handleClearData,
		isDemoLoaded: sourceMeta?.sourceType === 'demo',
		downloadPayload,
	};
}
