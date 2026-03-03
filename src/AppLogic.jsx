import { useState, useEffect, useCallback, useMemo } from 'react';

// Optional JSON preload file copied to web root by Vite static copy plugin.
// This file may not exist in all environments (e.g. web deploy), so load it at runtime.
import { logIfEnabled } from './shared/utils/utils.jsx';
import {
	getCatsFromPayload,
	getCurrentDayFromPayload,
	getScriptStartTimeFromPayload,
} from './shared/utils/catDataUtils.jsx';

export function useMewgenicsCatsLogic() {
	const [cats, setCats] = useState([]);
	const [sourceMeta, setSourceMeta] = useState(null);
	const [activeRoom, setActiveRoom] = useState('');
	const [loaded, setLoaded] = useState(false);
	const [savLoading, setSavLoading] = useState(false);
	const [savError, setSavError] = useState(null);
	const [hoveredCatId, setHoveredCatId] = useState(null);
	const [payloadMeta, setPayloadMeta] = useState({ basic: null, script_start_time: '' });

	const unpackPayload = useCallback((payloadLike) => {
		const unpackedCats = getCatsFromPayload(payloadLike);
		const currentDay = getCurrentDayFromPayload(payloadLike);
		const scriptStartTime = getScriptStartTimeFromPayload(payloadLike, unpackedCats);
		return {
			cats: unpackedCats,
			payloadMeta: {
				basic: typeof currentDay === 'number' ? { current_day: currentDay } : null,
				script_start_time: scriptStartTime,
			},
		};
	}, []);

	const formatDateText = useCallback((value) => {
		if (value === null || value === undefined || value === '') return '';

		const parsedValue =
			typeof value === 'number'
				? value
				: typeof value === 'string' && /^\d+$/.test(value)
					? Number(value)
					: value;

		const date = new Date(parsedValue);
		if (Number.isNaN(date.getTime())) return String(value);
		return date.toLocaleString();
	}, []);

	const getSourceMetaDateText = useCallback(
		(meta) => {
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

	const getSourceLabel = useCallback((sourceType) => {
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

	const downloadPayload = useMemo(() => {
		const payload = { cats };
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

	// Compute rooms from cats (memoized to avoid unnecessary re-renders)
	const rooms = useMemo(() => Array.from(new Set(cats.map((c) => c.room))), [cats]);

	// Keep activeRoom valid
	useEffect(() => {
		if (!rooms.includes(activeRoom)) setActiveRoom(rooms[0] || '');
	}, [activeRoom, rooms]);

	// Load cats from storage and JSON, using source precedence rules.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			let jsonCats = [];
			let jsonPayloadMeta = { basic: null, script_start_time: '' };
			let jsonSourceMeta = null;
			let storageCats = [];
			let storagePayloadMeta = { basic: null, script_start_time: '' };
			let storageSourceMeta = null;
			let storageFound;
			try {
				const isLocalDevelopment = import.meta.env.DEV;
				if (isLocalDevelopment) {
					// Optional preload JSON for local development only.
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
					const data = await response.json();
					const unpacked = unpackPayload(data);
					jsonCats = unpacked.cats;
					jsonPayloadMeta = unpacked.payloadMeta;
					jsonSourceMeta = {
						sourceType: 'preload-json',
						scriptStartTime: unpacked.payloadMeta.script_start_time,
						loadedAt: new Date().toISOString(),
					};
				}
			} catch (err) {
				logIfEnabled('[cats] optional preload JSON not used:', err?.message || err);
			}
			try {
				// Load localStorage
				const storageRaw = window.localStorage.getItem('mewgenics-v14');
				storageFound = storageRaw !== null;
				if (storageRaw !== null) {
					const parsed = JSON.parse(storageRaw);
					if (parsed?.payload && typeof parsed.payload === 'object') {
						const unpacked = unpackPayload(parsed.payload);
						storageCats = unpacked.cats;
						storagePayloadMeta = unpacked.payloadMeta;
					} else {
						storageCats = Array.isArray(parsed.cats) ? parsed.cats : [];
						storagePayloadMeta = parsed.payloadMeta || {
							basic:
								typeof parsed.current_day === 'number'
									? { current_day: parsed.current_day }
									: null,
							script_start_time:
								typeof parsed.script_start_time === 'string'
									? parsed.script_start_time
									: storageCats[0]?.script_start_time || '',
						};
					}
					storageSourceMeta = parsed.sourceMeta || null;
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

			// Source precedence:
			// - Prefer localStorage whenever found.
			// - Exception: in local development with preload JSON available, prefer preload JSON.
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

	// Save cats to storage
	useEffect(() => {
		if (!loaded) return;
		try {
			const payload = { cats };
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
		} catch (err) {
			logIfEnabled('[cats] failed to save localStorage:', err);
		}
	}, [cats, loaded, payloadMeta, sourceMeta]);

	// Handler for uploaded .sav file
	const handleUploadSav = useCallback(async (file) => {
		setSavLoading(true);
		setSavError(null);
		try {
			const { extractSaveFile } =
				await import('./data-grabber/javascript-with-wasm/extractSaveFile.js');
			const extractedCats = await extractSaveFile(file);
			if (!extractedCats.length) {
				setSavError('No housed cats found in save file.');
				return;
			}
			const nextSourceMeta = {
				sourceType: 'upload-sav',
				fileModifiedAt: typeof file?.lastModified === 'number' ? file.lastModified : '',
				scriptStartTime: extractedCats[0]?.script_start_time || '',
				loadedAt: new Date().toISOString(),
			};
			const inferredCurrentDay =
				typeof extractedCats[0]?.saveDay === 'number' ? extractedCats[0].saveDay : null;
			const nextPayloadMeta = {
				basic:
					typeof inferredCurrentDay === 'number'
						? { current_day: inferredCurrentDay }
						: null,
				script_start_time: extractedCats[0]?.script_start_time || '',
			};
			setCats(extractedCats);
			setPayloadMeta(nextPayloadMeta);
			setSourceMeta(nextSourceMeta);
			setLoaded(true);
			setActiveRoom([...new Set(extractedCats.map((c) => c.room))][0] || '');
			try {
				const payload = { cats: extractedCats };
				if (nextPayloadMeta.basic) payload.basic = nextPayloadMeta.basic;
				if (nextPayloadMeta.script_start_time) {
					payload.script_start_time = nextPayloadMeta.script_start_time;
				}
				window.localStorage.setItem(
					'mewgenics-v14',
					JSON.stringify({
						payload,
						cats: extractedCats,
						payloadMeta: nextPayloadMeta,
						sourceMeta: nextSourceMeta,
					})
				);
				logIfEnabled('[sav] saved extractedCats:', extractedCats);
			} catch (err) {
				logIfEnabled('[sav] failed to save extractedCats:', err);
			}
		} catch (err) {
			logIfEnabled('[extractSaveFile] Error:', err);
			setSavError(`Error reading save file: ${err.message}`);
		} finally {
			setSavLoading(false);
		}
	}, []);

	// Handler for loading demo data
	const handleLoadDemo = useCallback(async () => {
		try {
			const demoUrl = `${import.meta.env.BASE_URL}demo_mewgenics_cats.json`;
			const response = await fetch(demoUrl, { cache: 'no-store' });
			if (!response.ok) throw new Error(`Failed to fetch demo data: ${response.status}`);
			const data = await response.json();
			const unpacked = unpackPayload(data);
			const demoCats = unpacked.cats;
			if (!demoCats.length) return;
			const nextSourceMeta = {
				sourceType: 'demo',
				scriptStartTime: unpacked.payloadMeta.script_start_time,
				loadedAt: new Date().toISOString(),
			};
			setCats(demoCats);
			setPayloadMeta(unpacked.payloadMeta);
			setSourceMeta(nextSourceMeta);
			setLoaded(true);
			setActiveRoom([...new Set(demoCats.map((c) => c.room))][0] || '');
			try {
				const payload = { cats: demoCats };
				if (unpacked.payloadMeta.basic) payload.basic = unpacked.payloadMeta.basic;
				if (unpacked.payloadMeta.script_start_time) {
					payload.script_start_time = unpacked.payloadMeta.script_start_time;
				}
				window.localStorage.setItem(
					'mewgenics-v14',
					JSON.stringify({
						payload,
						cats: demoCats,
						payloadMeta: unpacked.payloadMeta,
						sourceMeta: nextSourceMeta,
					})
				);
				logIfEnabled('[demo] loaded demo cats:', demoCats);
			} catch (err) {
				logIfEnabled('[demo] failed to save demo cats:', err);
			}
		} catch (err) {
			logIfEnabled('[demo] Error loading demo data:', err);
			alert('Failed to load demo data.');
		}
	}, [unpackPayload]);

	// Handler for clearing all data (reset to initial empty state)
	const handleClearData = useCallback(() => {
		setCats([]);
		setSourceMeta(null);
		setPayloadMeta({ basic: null, script_start_time: '' });
		setActiveRoom('');
		try {
			window.localStorage.removeItem('mewgenics-v14');
			logIfEnabled('[clear] cleared all data and localStorage');
		} catch (err) {
			logIfEnabled('[clear] failed to clear localStorage:', err);
		}
	}, []);

	// Handler for uploaded JSON
	const handleUploadJson = useCallback(
		(uploadedPayload, file) => {
			const unpacked = unpackPayload(uploadedPayload);
			const uploadedCats = unpacked.cats;
			const nextSourceMeta = {
				sourceType: 'upload-json',
				fileModifiedAt: typeof file?.lastModified === 'number' ? file.lastModified : '',
				scriptStartTime: unpacked.payloadMeta.script_start_time,
				loadedAt: new Date().toISOString(),
			};
			setCats(uploadedCats);
			setPayloadMeta(unpacked.payloadMeta);
			setSourceMeta(nextSourceMeta);
			setLoaded(true);
			const newRooms = [...new Set(uploadedCats.map((c) => c.room))];
			setActiveRoom(newRooms[0] || '');
			try {
				const payload = { cats: uploadedCats };
				if (unpacked.payloadMeta.basic) payload.basic = unpacked.payloadMeta.basic;
				if (unpacked.payloadMeta.script_start_time) {
					payload.script_start_time = unpacked.payloadMeta.script_start_time;
				}
				window.localStorage.setItem(
					'mewgenics-v14',
					JSON.stringify({
						payload,
						cats: uploadedCats,
						payloadMeta: unpacked.payloadMeta,
						sourceMeta: nextSourceMeta,
					})
				);
				logIfEnabled('[json] saved uploadedCats:', uploadedCats);
			} catch (err) {
				logIfEnabled('[json] failed to save uploadedCats:', err);
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
