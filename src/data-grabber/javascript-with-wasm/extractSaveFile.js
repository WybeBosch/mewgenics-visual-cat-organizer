/**
 * extractSaveFile — main entry point for browser-side save file extraction.
 *
 * Accepts a browser File object (.sav), opens it as a SQLite database using
 * sql.js (WASM), and returns the same JSON array produced by mewgenics_extract.py.
 *
 * Everything runs in memory — nothing is written to disk.
 *
 * @param {File} file  The .sav file selected by the user
 * @returns {Promise<Array<object>>}  Cat objects matching the mewgenics_cats.json schema
 */

import { logIfEnabled } from '../../shared/utils/utils.jsx';
import { SECURITY_LIMITS } from '../../shared/config/config.jsx';
import { parseRoomAssignments, parsePedigree, parseCatBlob } from './parsers.js';
import { lz4DecompressBlock } from './lz4.js';
// Static import lets Vite/esbuild handle CJS→ESM conversion reliably.
// Lazy-loading still works because extractSaveFile.js itself is dynamically
// imported from mewgenics-cats.jsx (only loaded when the user clicks the button).
import initSqlJs from 'sql.js';
import wasmUrl from './public/compiled-binaries/sql-wasm.wasm?url';

// Module-level cache — WASM is loaded once per session, not on every upload
let sqlJsInstance = null;

async function getSqlJs() {
	if (sqlJsInstance) return sqlJsInstance;
	sqlJsInstance = await initSqlJs({
		// Use the correct URL for the wasm file in both dev and production
		locateFile: (filename) => {
			if (filename.endsWith('.wasm')) return wasmUrl;
			return filename;
		},
	});
	return sqlJsInstance;
}

export async function extractSaveFile(file) {
	const maxSaveUploadBytes = SECURITY_LIMITS.maxSaveUploadKb * 1024;
	const maxLz4DecompressedBytes = SECURITY_LIMITS.maxLz4DecompressedKb * 1024;
	const maxSaveSizeMb = Math.round(SECURITY_LIMITS.maxSaveUploadKb / 1024);

	if (!file || typeof file.size !== 'number' || file.size > maxSaveUploadBytes) {
		throw new Error(`Save file exceeds max size (${maxSaveSizeMb} MB).`);
	}

	const SQL = await getSqlJs();

	// Read the file entirely into memory as a Uint8Array
	const arrayBuffer = await file.arrayBuffer();
	const fileBytes = new Uint8Array(arrayBuffer);

	const db = new SQL.Database(fileBytes);

	try {
		// --- 1. Parse room assignments ---
		const houseResult = db.exec("SELECT data FROM files WHERE key='house_state'");
		logIfEnabled(
			'[extract] house_state rows:',
			houseResult.length,
			houseResult[0]?.values?.length
		);
		if (!houseResult.length || !houseResult[0].values.length) {
			throw new Error('house_state not found — is this a valid Mewgenics save file?');
		}
		const houseStateBlob = houseResult[0].values[0][0]; // Uint8Array from WASM heap
		logIfEnabled(
			'[extract] house_state blob type:',
			typeof houseStateBlob,
			houseStateBlob?.constructor?.name,
			'length:',
			houseStateBlob?.length,
			'first bytes:',
			houseStateBlob
				? Array.from(houseStateBlob.subarray(0, 12))
						.map((b) => b.toString(16).padStart(2, '0'))
						.join(' ')
				: 'n/a'
		);
		const roomMap = parseRoomAssignments(houseStateBlob);
		logIfEnabled(
			'[extract] roomMap size:',
			roomMap.size,
			'entries:',
			[...roomMap.entries()].slice(0, 5)
		);

		let selectedCatKeys = Array.from(roomMap.keys());
		if (selectedCatKeys.length === 0) {
			logIfEnabled('[extract] roomMap is empty; falling back to all cats from cats table');
			const allKeysResult = db.exec('SELECT key FROM cats ORDER BY key');
			if (allKeysResult.length && allKeysResult[0].values.length) {
				selectedCatKeys = allKeysResult[0].values.map(([key]) => key);
			}
		}
		if (selectedCatKeys.length === 0) return [];
		if (selectedCatKeys.length > SECURITY_LIMITS.maxCatsProcessed) {
			throw new Error(
				`Too many cats in save (${selectedCatKeys.length}). Max supported is ${SECURITY_LIMITS.maxCatsProcessed}.`
			);
		}

		// --- 2. Get max cat key (for pedigree validation) ---
		const maxKeyResult = db.exec('SELECT key FROM cats ORDER BY key DESC LIMIT 1');
		const maxCatKey = maxKeyResult[0].values[0][0];
		logIfEnabled('[extract] maxCatKey:', maxCatKey);

		// --- 3. Parse pedigree (parent map + saveDay) ---
		let parentMap = new Map();
		let saveDay = 0;
		const pedigreeResult = db.exec("SELECT data FROM files WHERE key='pedigree'");
		if (pedigreeResult.length && pedigreeResult[0].values.length) {
			const pedigreeBlob = pedigreeResult[0].values[0][0];
			parentMap = parsePedigree(pedigreeBlob, maxCatKey);
			// saveDay is an int32 at offset 4584 in the pedigree blob
			if (pedigreeBlob.length >= 4588) {
				const pdgBuf = pedigreeBlob.slice();
				const pdgView = new DataView(pdgBuf.buffer);
				saveDay = pdgView.getInt32(4584, true);
			}
		}
		logIfEnabled('[extract] saveDay:', saveDay, 'parentMap size:', parentMap.size);

		// --- 4. Fetch and parse housed cat blobs ---
		// Note: sql.js db.exec() doesn't reliably bind arrays for IN clauses the same
		// way Python's sqlite3 does. Since selectedCatKeys are parsed integers (not user input),
		// inlining them directly is safe and works correctly.
		const catsResult = db.exec(
			`SELECT key, data FROM cats WHERE key IN (${selectedCatKeys.join(',')}) ORDER BY key`
		);
		logIfEnabled('[extract] cat rows fetched:', catsResult[0]?.values?.length ?? 0);

		const housedCats = new Map();
		let parseFailCount = 0;
		if (catsResult.length) {
			for (const [catKey, blob] of catsResult[0].values) {
				// One-shot debug: log the first blob's raw details before parsing
				if (parseFailCount === 0 && housedCats.size === 0) {
					const b = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
					const bv = new DataView(b.buffer, b.byteOffset, b.byteLength);
					const claimedSize = b.length >= 4 ? bv.getUint32(0, true) : '?';
					logIfEnabled(
						'[extract] FIRST BLOB key:',
						catKey,
						'type:',
						typeof blob,
						blob?.constructor?.name,
						'length:',
						blob?.length,
						'claimedSize:',
						claimedSize,
						'first 16 bytes:',
						Array.from(b.subarray(0, 16))
							.map((x) => x.toString(16).padStart(2, '0'))
							.join(' ')
					);
					// Test LZ4 decompression directly
					try {
						const dec = lz4DecompressBlock(
							b.subarray(4),
							Number(claimedSize),
							maxLz4DecompressedBytes
						);
						const dv = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);
						const nameLen = dec.length >= 16 ? dv.getInt32(12, true) : '?';
						const pad16 = dec.length >= 20 ? dv.getInt32(16, true) : '?';
						logIfEnabled(
							'[extract] LZ4 dec.length:',
							dec.length,
							'dec[0..15]:',
							Array.from(dec.subarray(0, 16))
								.map((x) => x.toString(16).padStart(2, '0'))
								.join(' '),
							'nameLen@12:',
							nameLen,
							'pad@16:',
							pad16
						);
					} catch (e) {
						logIfEnabled('[extract] LZ4 threw:', e.message);
					}
				}
				const parsed = parseCatBlob(catKey, blob, saveDay);
				if (parsed) {
					housedCats.set(catKey, parsed);
				} else {
					parseFailCount++;
					if (parseFailCount <= 3)
						logIfEnabled(
							'[extract] parseCatBlob failed for key:',
							catKey,
							'blob length:',
							blob?.length
						);
				}
			}
		}
		logIfEnabled('[extract] housedCats parsed:', housedCats.size, 'failed:', parseFailCount);

		const successfulKeys = new Set(housedCats.keys());

		// --- 5. Collect ancestor keys for name lookups ---
		const ancestorKeys = new Set();
		for (const key of successfulKeys) {
			const cat = housedCats.get(key);
			const [p1, p2] = parentMap.get(key) || [-1, -1];
			for (const pk of [p1, p2]) {
				if (pk > 0) {
					ancestorKeys.add(pk);
					const [gp1, gp2] = parentMap.get(pk) || [-1, -1];
					if (gp1 > 0) ancestorKeys.add(gp1);
					if (gp2 > 0) ancestorKeys.add(gp2);
				}
			}
			if (cat.loves_key > 0) ancestorKeys.add(cat.loves_key);
			if (cat.hates_key > 0) ancestorKeys.add(cat.hates_key);
		}

		// Only fetch ancestors we don't already have
		const missingKeys = Array.from(ancestorKeys).filter((k) => !successfulKeys.has(k));

		// --- 6. Fetch ancestor blobs for name lookups ---
		const ancestorCats = new Map();
		if (missingKeys.length > 0) {
			const ancResult = db.exec(
				`SELECT key, data FROM cats WHERE key IN (${missingKeys.join(',')}) ORDER BY key`
			);
			if (ancResult.length) {
				for (const [catKey, blob] of ancResult[0].values) {
					const parsed = parseCatBlob(catKey, blob, saveDay);
					if (parsed) ancestorCats.set(catKey, parsed);
				}
			}
		}

		// --- 7. Build name lookup ---
		const nameLookup = new Map();
		for (const [k, v] of housedCats) nameLookup.set(k, v.name);
		for (const [k, v] of ancestorCats) nameLookup.set(k, v.name);

		function getName(key) {
			if (!key || key <= 0) return '';
			return nameLookup.get(key) ?? `?key${key}`;
		}

		// --- 8. Assemble output ---
		// Timestamp matching Python format: "2026-02-26T12:01:14" (no milliseconds)
		const scriptStartTime = new Date().toISOString().slice(0, 19);

		const sortedKeys = Array.from(successfulKeys).sort((a, b) => a - b);

		return sortedKeys.map((key) => {
			const cat = housedCats.get(key);
			let [p1Key, p2Key] = parentMap.get(key) || [-1, -1];
			if (p1Key > 0 && p1Key === p2Key) {
				p2Key = -1;
			}

			// Grandparents: each parent's parent pair
			const gpKeys = [];
			for (const pk of [p1Key, p2Key]) {
				if (pk > 0 && parentMap.has(pk)) {
					const [gp1, gp2] = parentMap.get(pk);
					gpKeys.push(gp1, gp2);
				} else {
					gpKeys.push(-1, -1);
				}
			}

			const isStray = p1Key <= 0 && p2Key <= 0;

			return {
				name: cat.name,
				id: cat.name.toLowerCase().replace(/ /g, '_'),
				icon: cat.icon || '',
				sex: cat.sex,
				STR: cat.STR,
				DEX: cat.DEX,
				CON: cat.CON,
				INT: cat.INT,
				SPD: cat.SPD,
				CHA: cat.CHA,
				LCK: cat.LCK,
				libido: cat.libido,
				libido_raw: cat.libido_raw,
				aggression: cat.aggression,
				aggression_raw: cat.aggression_raw,
				loves: getName(cat.loves_key),
				hates: getName(cat.hates_key),
				room: roomMap.get(key) || '',
				stray: isStray,
				parent1: getName(p1Key),
				parent2: getName(p2Key),
				grandparent1: getName(gpKeys[0]),
				grandparent2: getName(gpKeys[1]),
				grandparent3: getName(gpKeys[2]),
				grandparent4: getName(gpKeys[3]),
				saveDay,
				birthday: cat.birthday ?? null,
				script_start_time: scriptStartTime,
			};
		});
	} finally {
		db.close();
	}
}
