import { logIfEnabled } from '../../shared/utils/utils.jsx';
import { SECURITY_LIMITS } from '../../shared/config/config.jsx';
// Cat extractor version v4
logIfEnabled('Cat extractor version v4');
/**
 * Binary parsers for Mewgenics save file blobs — ported from mewgenics_extract.py
 *
 * Three exports:
 *   parseRoomAssignments(houseState)  → Map<catKey, roomName>
 *   parsePedigree(pedigree, maxKey)   → Map<childKey, [parent1Key, parent2Key]>
 *   parseCatBlob(key, blob, saveDay)  → cat object | null
 */

import { lz4DecompressBlock } from './lz4.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Search a Uint8Array for a byte sequence, returning the index or -1.
 * Equivalent to Python's bytes.find(needle, start).
 */
function findBytes(haystack, needle, startOffset = 0) {
	const end = haystack.length - needle.length;
	outer: for (let i = startOffset; i <= end; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}

const NONE_BYTES = new Uint8Array([78, 111, 110, 101]); // "None"
const NONE_LOWER = new Uint8Array([110, 111, 110, 101]); // "none"

/**
 * Convert a BigInt read from DataView to a plain Number.
 * Cat keys and day values fit safely in 53-bit integers.
 */
function bigToNum(big) {
	const n = Number(big);
	if (!Number.isSafeInteger(n)) return null;
	return n;
}

// ---------------------------------------------------------------------------
// parseRoomAssignments
// ---------------------------------------------------------------------------

/**
 * Parse the house_state blob to get cat_key → room_name mapping.
 *
 * Layout (Python source: lines 364-409):
 *   Header 8 bytes: int32(0) + int32(entry_count)
 *   Per entry:
 *     int32(cat_key) + int32(0)                   — 8 bytes
 *     int32(str_len) + int32(0) + room(ascii)      — 8+N bytes
 *     float64(x) + float64(y) + float64(z)         — 24 bytes
 *
 * @param {Uint8Array} houseState
 * @returns {Map<number, string>}
 */
export function parseRoomAssignments(houseState) {
	// Use a standalone copy so DataView offsets are always relative to byte 0
	const buf = houseState.slice();
	const view = new DataView(buf.buffer);
	const count = view.getUint32(4, true);
	const roomMap = new Map();
	let pos = 8;

	for (let i = 0; i < count; i++) {
		if (pos + 16 > buf.length) break;
		const catKey = view.getUint32(pos, true);
		const slen = view.getUint32(pos + 8, true);
		if (slen > 30) break;
		if (pos + 16 + slen + 24 > buf.length) break;
		const roomName = new TextDecoder('ascii').decode(buf.subarray(pos + 16, pos + 16 + slen));
		roomMap.set(catKey, roomName);
		pos = pos + 16 + slen + 24;
	}

	return roomMap;
}

// ---------------------------------------------------------------------------
// parsePedigree
// ---------------------------------------------------------------------------

/**
 * Parse the pedigree blob to extract parent pairs.
 *
 * Int64 triplets starting at offset 552, read as (child, parent2, parent1).
 * Child key is always higher than both parents (born after them).
 *
 * @param {Uint8Array} pedigree
 * @param {number} maxCatKey
 * @returns {Map<number, [number, number]>}  child → [parent1, parent2]
 */
export function parsePedigree(pedigree, maxCatKey) {
	const DATA_START = 552;
	if (pedigree.length < DATA_START + 24) return new Map();

	const buf = pedigree.slice();
	const view = new DataView(buf.buffer);
	const allVals = [];

	for (let off = DATA_START; off + 8 <= buf.length; off += 8) {
		const big = view.getBigInt64(off, true);
		allVals.push({ off, val: bigToNum(big) });
	}

	function isCatOrSentinel(v) {
		return v !== null && ((v >= 1 && v <= maxCatKey) || v === -1);
	}

	function scoreParentPair(parent1Key, parent2Key) {
		if (parent1Key === -1 && parent2Key === -1) return 0;
		if (parent1Key > 0 && parent2Key > 0 && parent1Key !== parent2Key) return 4;
		if (parent1Key > 0 && parent2Key > 0 && parent1Key === parent2Key) return -1;
		return 2;
	}

	const parentMap = new Map();
	const parentScoreMap = new Map();

	for (let i = 0; i < allVals.length - 2; i++) {
		const { off: o1, val: v1 } = allVals[i];
		const { off: o2, val: v2 } = allVals[i + 1];
		const { off: o3, val: v3 } = allVals[i + 2];

		// Must be consecutive 8-byte positions
		if (o2 - o1 !== 8 || o3 - o2 !== 8) continue;
		// First value is a valid child key
		if (!(v1 >= 1 && v1 <= maxCatKey)) continue;
		// Second and third are parents or -1 sentinel
		if (!isCatOrSentinel(v2)) continue;
		if (!isCatOrSentinel(v3)) continue;
		// Child key must be greater than both parents
		if (v2 !== -1 && v1 <= v2) continue;
		if (v3 !== -1 && v1 <= v3) continue;

		// File order: (child, parent2, parent1) → store as [parent1, parent2]
		const pair = [v3, v2];
		const pairScore = scoreParentPair(pair[0], pair[1]);

		if (!parentMap.has(v1)) {
			parentMap.set(v1, pair);
			parentScoreMap.set(v1, pairScore);
			continue;
		}

		const existingScore = parentScoreMap.get(v1) ?? Number.NEGATIVE_INFINITY;
		if (pairScore > existingScore) {
			parentMap.set(v1, pair);
			parentScoreMap.set(v1, pairScore);
		}
	}

	return parentMap;
}

// ---------------------------------------------------------------------------
// findBirthdayInfo (internal helper)
// ---------------------------------------------------------------------------

/**
 * Find the birthday day value in a decompressed cat blob.
 *
 * Near the end of the blob there is a u64-length-prefixed ASCII class name.
 * 12 bytes after its end is an int64 birthday_day, followed by int64 sentinel = -1.
 *
 * @param {Uint8Array} dec  Decompressed blob
 * @param {number|null} saveDay
 * @returns {{ birthdayDay: number|null }}
 */
function findBirthdayInfo(dec, saveDay) {
	const n = dec.length;
	if (n < 64) return { birthdayDay: null };

	const view = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);
	const AGE_CAP = 500_000;

	function accept(bday) {
		if (saveDay == null) return true;
		const age = saveDay - bday;
		return age >= 0 && age <= AGE_CAP;
	}

	function looksAsciiIdent(bytes) {
		return bytes.every((b) => b >= 32 && b < 127);
	}

	function scanRange(start, end) {
		let best = null;
		for (let off = start; off < Math.max(start, end - 8); off++) {
			if (off + 8 > n) break;
			// u64 length: read as two uint32 (hi must be 0; lo must be 3–64)
			const lnLow = view.getUint32(off, true);
			const lnHigh = view.getUint32(off + 4, true);
			if (lnHigh !== 0 || lnLow < 3 || lnLow > 64) continue;
			const ln = lnLow;
			const strOff = off + 8;
			const strEnd = strOff + ln;
			const bdayOff = strEnd + 12;
			if (bdayOff + 16 > n) continue;
			const sb = dec.subarray(strOff, strEnd);
			if (!looksAsciiIdent(sb)) continue;
			const bdayBig = view.getBigInt64(bdayOff, true);
			const sentinelBig = view.getBigInt64(bdayOff + 8, true);
			if (sentinelBig !== -1n) continue;
			const bday = bigToNum(bdayBig);
			if (bday === null || !accept(bday)) continue;
			if (best === null || bdayOff > best.bdayOff) {
				best = { birthdayDay: bday, bdayOff };
			}
		}
		return best;
	}

	const TAIL = 2048;
	let found = scanRange(Math.max(0, n - TAIL), n);
	if (!found) found = scanRange(0, n);
	return { birthdayDay: found ? found.birthdayDay : null };
}

// ---------------------------------------------------------------------------
// parseCatBlob
// ---------------------------------------------------------------------------

/**
 * Parse a single cat record from its LZ4-compressed blob.
 *
 * Blob layout (after decompression) — see Python source lines 186-357 for details.
 *
 * @param {number} key
 * @param {Uint8Array} blob  Raw blob from the cats table
 * @param {number|null} saveDay  Current in-game day (for age validation)
 * @returns {object|null}
 */
export function parseCatBlob(key, blob, saveDay) {
	if (key === 0) {
		// Only log once per extraction session
		logIfEnabled('Cat extractor version v3');
	}
	if (blob.length < 8) {
		logIfEnabled(`[parseCatBlob] key=${key} fail: blob too short (${blob.length})`);
		return null;
	}

	// Use a standalone copy so all DataView offsets are from byte 0
	const rawBlob = blob.slice();
	const headerView = new DataView(rawBlob.buffer);
	const claimedSize = headerView.getUint32(0, true);

	let dec;
	try {
		dec = lz4DecompressBlock(
			rawBlob.subarray(4),
			claimedSize,
			SECURITY_LIMITS.maxLz4DecompressedKb * 1024
		);
	} catch (e) {
		logIfEnabled(`[parseCatBlob] key=${key} fail: LZ4 decompress error`, e);
		return null;
	}
	if (dec.length < 200) {
		logIfEnabled(`[parseCatBlob] key=${key} fail: decompressed too short (${dec.length})`);
		return null;
	}

	const view = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);

	// --- Name (UTF-16-LE) ---
	const nameLen = view.getInt32(12, true);
	const pad16 = view.getInt32(16, true);
	if (nameLen > 30 || pad16 !== 0) {
		logIfEnabled(`[parseCatBlob] key=${key} fail: nameLen=${nameLen} pad16=${pad16}`);
		return null;
	}
	let name;
	try {
		name = new TextDecoder('utf-16le').decode(dec.subarray(20, 20 + nameLen * 2));
	} catch (e) {
		logIfEnabled(`[parseCatBlob] key=${key} fail: name decode error`, e);
		return null;
	}
	const nameEnd = 20 + nameLen * 2;
	// Log name extraction
	logIfEnabled(`[parseCatBlob] key=${key} nameLen=${nameLen} pad16=${pad16} name='${name}'`);

	// --- Gender/sprite string (e.g. "male15", "female52") ---
	// The string is preceded by: int32(str_len) + int32(0).
	// Use header-declared length to avoid greedy digit bleeding.
	let genderOff = -1;
	let genderStr = '';
	const searchEnd = Math.min(dec.length - 6, nameEnd + 500);
	for (let i = nameEnd; i < searchEnd; i++) {
		const isFemale =
			dec[i] === 102 &&
			dec[i + 1] === 101 &&
			dec[i + 2] === 109 &&
			dec[i + 3] === 97 &&
			dec[i + 4] === 108 &&
			dec[i + 5] === 101; // "female"
		const isMale =
			dec[i] === 109 && dec[i + 1] === 97 && dec[i + 2] === 108 && dec[i + 3] === 101; // "male"
		// Exclude "female" prefix when checking for "male"
		const isMaleOnly = isMale && !(i >= 2 && dec[i - 2] === 102 && dec[i - 1] === 101); // not preceded by "fe"

		if (isFemale || isMaleOnly) {
			// Try reading header at i-8
			if (i >= 8) {
				const headerLen = view.getInt32(i - 8, true);
				const headerPad = view.getInt32(i - 4, true);
				if (headerLen >= 4 && headerLen <= 20 && headerPad === 0) {
					genderStr = new TextDecoder('ascii').decode(dec.subarray(i, i + headerLen));
					genderOff = i;
					logIfEnabled(
						`[parseCatBlob] key=${key} genderStr(header)='${genderStr}' at ${i} headerLen=${headerLen} headerPad=${headerPad}`
					);
					break;
				}
			}
			// Fallback: greedy digit scan
			const prefixLen = isFemale ? 6 : 4;
			let end = i + prefixLen;
			while (end < dec.length && dec[end] >= 48 && dec[end] <= 57) end++; // '0'-'9'
			genderStr = new TextDecoder('ascii').decode(dec.subarray(i, end));
			genderOff = i;
			logIfEnabled(`[parseCatBlob] key=${key} genderStr(fallback)='${genderStr}' at ${i}`);
			break;
		}
	}

	if (!genderStr || genderOff < 16) {
		logIfEnabled(
			`[parseCatBlob] key=${key} fail: genderStr='${genderStr}' genderOff=${genderOff}`
		);
		return null;
	}

	// --- Stats: 7× int32, starting 8 bytes after the gender string ---
	const gsEnd = genderOff + genderStr.length;
	if (gsEnd + 36 > dec.length) {
		logIfEnabled(
			`[parseCatBlob] key=${key} fail: stats out of bounds gsEnd=${gsEnd} dec.length=${dec.length}`
		);
		return null;
	}
	const stats = [];
	for (let j = 0; j < 7; j++) {
		stats.push(view.getInt32(gsEnd + 8 + j * 4, true));
	}
	if (stats.some((s) => s < -10 || s > 30)) {
		logIfEnabled(`[parseCatBlob] key=${key} fail: stats invalid`, stats);
		return null;
	}

	// --- Libido & aggression (float64) from the slot region after "None" ---
	// Slot layout (8 bytes each, base = None+8):
	//   slot 0: libido, slot 4: aggression
	let libidoRaw = 0.5;
	let aggressionRaw = 0.5;
	let noneOff = findBytes(dec, NONE_BYTES, nameEnd);
	if (noneOff < 0) noneOff = findBytes(dec, NONE_LOWER, nameEnd);
	if (noneOff >= 0) {
		const slotBase = noneOff + 8;
		if (slotBase + 40 <= dec.length) {
			libidoRaw = view.getFloat64(slotBase, true);
			aggressionRaw = view.getFloat64(slotBase + 32, true);
			logIfEnabled(
				`[parseCatBlob] key=${key} libidoRaw=${libidoRaw} aggressionRaw=${aggressionRaw}`
			);
		}
	}

	// --- Loves / hates keys (int32, slots 2 and 5) ---
	let lovesKey = -1;
	let hatesKey = -1;
	// Re-find None (may have been set above, but scoped inside the if)
	let noneOff2 = findBytes(dec, NONE_BYTES, nameEnd);
	if (noneOff2 < 0) noneOff2 = findBytes(dec, NONE_LOWER, nameEnd);
	if (noneOff2 >= 0) {
		const slotBase = noneOff2 + 8;
		const lovesOff = slotBase + 2 * 8;
		const hatesOff = slotBase + 5 * 8;
		if (lovesOff + 4 <= dec.length) {
			const v = view.getUint32(lovesOff, true);
			lovesKey = v === 0xffffffff ? -1 : v;
		}
		if (hatesOff + 4 <= dec.length) {
			const v = view.getUint32(hatesOff, true);
			hatesKey = v === 0xffffffff ? -1 : v;
		}
		logIfEnabled(`[parseCatBlob] key=${key} lovesKey=${lovesKey} hatesKey=${hatesKey}`);
	}

	// --- Icon & sex byte: right after the icon string that follows the name ---
	// Layout after name: int32(icon_len) + int32(pad=0) + icon_bytes + sex_byte
	const iconLen = view.getUint32(nameEnd, true);
	const icon =
		iconLen > 0 && iconLen < 100
			? new TextDecoder('ascii').decode(dec.subarray(nameEnd + 8, nameEnd + 8 + iconLen))
			: '';
	const sexByteOff = nameEnd + 8 + iconLen;
	const sexByte = sexByteOff < dec.length ? dec[sexByteOff] : 0;
	const SEX = { 0: 'male', 1: 'female', 2: 'herm' };
	const sex = SEX[sexByte] ?? `unknown(${sexByte})`;
	logIfEnabled(
		`[parseCatBlob] key=${key} iconLen=${iconLen} icon='${icon}' sexByteOff=${sexByteOff} sexByte=${sexByte} sex=${sex}`
	);

	// --- Birthday ---
	const { birthdayDay } = findBirthdayInfo(dec, saveDay);
	logIfEnabled(`[parseCatBlob] key=${key} birthdayDay=${birthdayDay}`);

	// --- Classify trait ---
	function classifyTrait(val) {
		if (val < 0.333) return 'low';
		if (val < 0.667) return 'average';
		return 'high';
	}
	// Final success log
	logIfEnabled(
		`[parseCatBlob] key=${key} SUCCESS name='${name}' sex=${sex} stats=${JSON.stringify(stats)}`
	);

	return {
		key,
		name,
		icon,
		sex,
		STR: stats[0],
		DEX: stats[1],
		CON: stats[2],
		INT: stats[3],
		SPD: stats[4],
		CHA: stats[5],
		LCK: stats[6],
		libido: classifyTrait(libidoRaw),
		libido_raw: Math.round(libidoRaw * 10000) / 10000,
		aggression: classifyTrait(aggressionRaw),
		aggression_raw: Math.round(aggressionRaw * 10000) / 10000,
		loves_key: lovesKey,
		hates_key: hatesKey,
		birthday: birthdayDay,
	};
}
