"""
parse_save.py - Mewgenics save file parser for Pyodide
Optimized for browser use with minimal dependencies
"""

import sqlite3
import struct
import io
import json
import argparse
import contextlib
import datetime
import sys
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any

# Helper to safely convert BLOB data to bytes (Pyodide may return memoryview)
def to_bytes(data) -> bytes:
    if data is None:
        return b""
    if isinstance(data, bytes):
        return data
    if isinstance(data, memoryview):
        return data.tobytes()
    return bytes(data)

# LZ4 block decompression - pure Python implementation for Pyodide
def lz4_decompress_block(src: bytes, dst_size: int) -> bytes:
    """Decompress LZ4 block format (without frame header)"""
    dst = bytearray(dst_size)
    src_pos = 0
    dst_pos = 0
    src_len = len(src)

    while src_pos < src_len and dst_pos < dst_size:
        token = src[src_pos]
        src_pos += 1
        literal_len = (token >> 4) & 0x0f
        match_len = token & 0x0f

        # Read literal length extension
        if literal_len == 15:
            while src_pos < src_len and src[src_pos] == 255:
                literal_len += 255
                src_pos += 1
            if src_pos >= src_len:
                break
            literal_len += src[src_pos]
            src_pos += 1

        # Copy literals
        if src_pos + literal_len > src_len:
            literal_len = src_len - src_pos
        for i in range(literal_len):
            if dst_pos >= dst_size:
                break
            dst[dst_pos] = src[src_pos]
            dst_pos += 1
            src_pos += 1

        if src_pos >= src_len or dst_pos >= dst_size:
            break
        if src_pos + 2 > src_len:
            break

        # Read match offset
        match_off = src[src_pos] | (src[src_pos + 1] << 8)
        src_pos += 2

        if match_off == 0 or match_off > dst_pos:
            break

        # Read match length extension
        mlen = match_len + 4
        if match_len == 15:
            while src_pos < src_len and src[src_pos] == 255:
                mlen += 255
                src_pos += 1
            if src_pos < src_len:
                mlen += src[src_pos]
                src_pos += 1

        # Copy match
        for i in range(mlen):
            if dst_pos >= dst_size:
                break
            dst[dst_pos] = dst[dst_pos - match_off]
            dst_pos += 1

    return bytes(dst)


# Binary helpers
def u16_le(b: bytes, off: int) -> int:
    return struct.unpack_from("<H", b, off)[0]


def u32_le(b: bytes, off: int) -> int:
    return struct.unpack_from("<I", b, off)[0]


def u64_le(b: bytes, off: int) -> int:
    return struct.unpack_from("<Q", b, off)[0]


def decompress_cat_blob(wrapped: bytes) -> Tuple[bytes, str]:
    """Decompress cat BLOB, returns (data, variant)"""
    if len(wrapped) < 4:
        raise ValueError("Blob too small")

    uncomp = u32_le(wrapped, 0)

    if len(wrapped) >= 8:
        comp_len = u32_le(wrapped, 4)
        if 0 < comp_len <= len(wrapped) - 8:
            stream = wrapped[8:8 + comp_len]
            try:
                dec = lz4_decompress_block(stream, uncomp)
                return dec, "B"
            except Exception:
                pass

    stream = wrapped[4:]
    dec = lz4_decompress_block(stream, uncomp)
    return dec, "A"


# Constants
SEX_MAP = {0: "Male", 1: "Female", 2: "Ditto"}
CAT_CLASSES = ["Colorless", "Mage", "Fighter", "Hunter", "Thief", "Tank",
               "Medic", "Monk", "Butcher", "Druid", "Tinkerer", "Necromancer",
               "Psychic", "Jester"]


def parse_house_state(blob: bytes) -> List[Tuple[int, str]]:
    """Parse house_state, returns [(cat_key, room), ...]"""
    if len(blob) < 8:
        return []

    ver = u32_le(blob, 0)
    cnt = u32_le(blob, 4)

    if ver != 0 or cnt > 512:
        return []

    off = 8
    cats = []
    for _ in range(cnt):
        if off + 16 > len(blob):
            break
        key = u32_le(blob, off)
        room_len = u64_le(blob, off + 8)
        name_off = off + 16
        if name_off + room_len > len(blob):
            break
        room = blob[name_off:name_off + room_len].decode("ascii", errors="replace")
        d_off = name_off + room_len
        if d_off + 24 > len(blob):
            break
        cats.append((key, room))
        off = d_off + 24

    return cats


def parse_adventure_state(blob: bytes) -> List[int]:
    """Parse adventure_state, returns cat_key list"""
    if not blob or len(blob) < 8:
        return []

    ver = u32_le(blob, 0)
    cnt = u32_le(blob, 4)

    if cnt > 8:
        return []

    off = 8
    keys = []
    for _ in range(cnt):
        if off + 8 > len(blob):
            break
        v = u64_le(blob, off)
        off += 8
        hi = (v >> 32) & 0xFFFFFFFF
        lo = v & 0xFFFFFFFF
        key = int(hi if hi != 0 else lo)
        if 0 < key <= 1000000:
            keys.append(key)

    return keys


def detect_name_end_and_sex(dec: bytes) -> Tuple[int, int, str, str]:
    """Detect name end position and sex"""
    best = None

    for off_len in (0x0C, 0x10):
        if off_len + 4 > len(dec):
            continue
        nl = u32_le(dec, off_len)
        if not (0 <= nl <= 128):
            continue
        start = 0x14
        end = start + nl * 2
        if end > len(dec):
            continue

        name = dec[start:end].decode("utf-16le", errors="replace").rstrip("\x00")
        sex = "Unknown"
        score = 0
        off_a = end + 8
        off_b = end + 12
        if off_b + 2 <= len(dec):
            a = u16_le(dec, off_a)
            b = u16_le(dec, off_b)
            if a == b and a in SEX_MAP:
                sex = SEX_MAP[a]
                score += 4
            elif a in SEX_MAP or b in SEX_MAP:
                sex = SEX_MAP.get(a, SEX_MAP.get(b, "Unknown"))
                score += 2

        if name:
            score += 1

        cand = (score, int(nl), int(end), name, sex)
        if best is None or cand[0] > best[0]:
            best = cand

    if best is None:
        return 0, 0x14, "", "Unknown"
    _, nl, end, name, sex = best
    return nl, end, name, sex


def fallback_name_from_fixed_layout(dec: bytes) -> Optional[Tuple[int, int, str]]:
    """Strict name extraction using fixed layout used by mewgenics_extract.py.

    Layout (after decompression):
      [12..15] name length (utf-16 code units)
      [16..19] padding (expected 0)
      [20..]   utf-16le name bytes
    """
    if len(dec) < 20:
        return None

    try:
        name_len = u32_le(dec, 12)
    except Exception:
        return None

    if not (0 < name_len <= 30):
        return None
    if u32_le(dec, 16) != 0:
        return None

    name_start = 20
    name_end = name_start + name_len * 2
    if name_end > len(dec):
        return None

    try:
        name = dec[name_start:name_end].decode("utf-16le", errors="strict").rstrip("\x00")
    except Exception:
        return None

    if not name.strip():
        return None

    return int(name_len), int(name_end), name


def read_status_flags(dec: bytes, name_end_raw: int) -> Tuple[bool, bool, bool]:
    """Read status flags (retired, dead, donated)"""
    flags_off = name_end_raw + 0x10
    if flags_off + 2 > len(dec):
        return False, False, False

    flags = u16_le(dec, flags_off)
    retired = bool(flags & 0x0002)
    dead = bool(flags & 0x0020)
    donated = bool(flags & 0x4000)
    return retired, dead, donated


def classify_trait(value: float) -> str:
    if value < 0.333:
        return "low"
    if value < 0.667:
        return "average"
    return "high"


def read_sex_from_tag(dec: bytes, name_end: int) -> str:
    """Read sex byte from tag layout after name; returns extractor-style labels."""
    if name_end + 8 > len(dec):
        return "unknown"

    try:
        tag_len = u32_le(dec, name_end)
    except Exception:
        return "unknown"

    if tag_len < 0 or tag_len > 1000:
        return "unknown"

    sex_byte_off = name_end + 8 + tag_len
    if sex_byte_off >= len(dec):
        return "unknown"

    sex_byte = dec[sex_byte_off]
    sex_map = {0: "male", 1: "female", 2: "herm"}
    if sex_byte in sex_map:
        return sex_map[sex_byte]
    return f"unknown({sex_byte})"


def parse_social_fields(dec: bytes, name_end: int) -> Dict[str, Any]:
    """Parse icon/libido/aggression/loves/hates from decompressed cat blob."""
    icon = ""
    libido_raw = 0.5
    aggression_raw = 0.5
    loves_key = -1
    hates_key = -1

    if name_end + 8 <= len(dec):
        tag_len = u32_le(dec, name_end)
        if 0 <= tag_len < 100 and name_end + 8 + tag_len <= len(dec):
            icon = dec[name_end + 8:name_end + 8 + tag_len].decode("ascii", errors="replace")

    none_off = dec.find(b"None", name_end)
    if none_off < 0:
        none_off = dec.find(b"none", name_end)

    if none_off >= 0:
        slot_base = none_off + 8

        if slot_base + 40 <= len(dec):
            try:
                libido_val = struct.unpack_from("<d", dec, slot_base + 0)[0]
                aggression_val = struct.unpack_from("<d", dec, slot_base + 32)[0]
                if 0.0 <= libido_val <= 1.0:
                    libido_raw = libido_val
                if 0.0 <= aggression_val <= 1.0:
                    aggression_raw = aggression_val
            except Exception:
                pass

        loves_off = slot_base + 16
        hates_off = slot_base + 40
        if loves_off + 4 <= len(dec):
            loves_key = struct.unpack_from("<i", dec, loves_off)[0]
        if hates_off + 4 <= len(dec):
            hates_key = struct.unpack_from("<i", dec, hates_off)[0]

    return {
        "icon": icon,
        "libido_raw": float(libido_raw),
        "libido": classify_trait(float(libido_raw)),
        "aggression_raw": float(aggression_raw),
        "aggression": classify_trait(float(aggression_raw)),
        "loves_key": int(loves_key),
        "hates_key": int(hates_key),
    }


def find_birthday_info(dec: bytes, current_day: Optional[int] = None) -> Tuple[str, Optional[int], Optional[int]]:
    """Find (class_name, birthday_day, birthday_off) in a decompressed cat blob."""
    n = len(dec)
    if n < 64:
        return ("", None, None)

    age_cap = 500_000

    def _accept(bday: int) -> bool:
        if current_day is None:
            return True
        age = int(current_day) - int(bday)
        return 0 <= age <= age_cap

    def _looks_ascii_ident(sb: bytes) -> bool:
        return all(32 <= b < 127 for b in sb)

    def _scan_range(start: int, end: int) -> Optional[Tuple[str, int, int]]:
        best: Optional[Tuple[str, int, int]] = None
        for off in range(start, max(start, end - 8)):
            if off + 8 > n:
                break
            ln = u64_le(dec, off)
            if ln <= 0 or ln > 64:
                continue
            str_start = off + 8
            str_end = str_start + ln
            if str_end > n:
                continue
            ident_raw = dec[str_start:str_end]
            if not _looks_ascii_ident(ident_raw):
                continue
            try:
                ident = ident_raw.decode("ascii")
            except Exception:
                continue

            bday_off = str_end + 12
            sent_off = bday_off + 8
            if sent_off + 8 > n:
                continue
            bday = struct.unpack_from("<q", dec, bday_off)[0]
            sentinel = struct.unpack_from("<q", dec, sent_off)[0]
            if sentinel != -1:
                continue
            if not _accept(int(bday)):
                continue

            cand = (ident, int(bday), int(bday_off))
            if best is None:
                best = cand
            else:
                _, cur_bday, _ = best
                cur_age = abs(int(current_day) - cur_bday) if current_day is not None else 0
                new_age = abs(int(current_day) - int(bday)) if current_day is not None else 0
                if new_age < cur_age:
                    best = cand
        return best

    tail = 2048
    found = _scan_range(max(0, n - tail), n)
    if found:
        return found
    found = _scan_range(0, n)
    if found:
        return found
    return ("", None, None)


def parse_pedigree(blob: bytes, max_cat_key: int) -> Dict[int, Tuple[int, int]]:
    """Parse pedigree blob and return child_key -> (parent1_key, parent2_key)."""
    data_start = 552
    if len(blob) < data_start + 24:
        return {}

    all_vals: List[Tuple[int, int]] = []
    for off in range(data_start, len(blob) - 8, 8):
        v = struct.unpack_from("<q", blob, off)[0]
        all_vals.append((off, int(v)))

    def is_cat_or_sentinel(v: int) -> bool:
        return (1 <= v <= max_cat_key) or v == -1

    def score_parent_pair(parent1_key: int, parent2_key: int) -> int:
        if parent1_key == -1 and parent2_key == -1:
            return 1
        if parent1_key > 0 and parent2_key > 0 and parent1_key != parent2_key:
            return 3
        if parent1_key > 0 and parent2_key > 0 and parent1_key == parent2_key:
            return 2
        return 2

    parent_map: Dict[int, Tuple[int, int]] = {}
    parent_score_map: Dict[int, int] = {}

    for i in range(len(all_vals) - 2):
        o1, v1 = all_vals[i]
        o2, v2 = all_vals[i + 1]
        o3, v3 = all_vals[i + 2]

        if o2 - o1 != 8 or o3 - o2 != 8:
            continue
        if not (1 <= v1 <= max_cat_key):
            continue
        if not is_cat_or_sentinel(v2):
            continue
        if not is_cat_or_sentinel(v3):
            continue
        if v2 != -1 and v1 <= v2:
            continue
        if v3 != -1 and v1 <= v3:
            continue

        parent1_key = v3
        parent2_key = v2
        pair_score = score_parent_pair(parent1_key, parent2_key)

        if v1 not in parent_map:
            parent_map[v1] = (parent1_key, parent2_key)
            parent_score_map[v1] = pair_score
        elif pair_score > parent_score_map.get(v1, -1):
            parent_map[v1] = (parent1_key, parent2_key)
            parent_score_map[v1] = pair_score

    return parent_map


def extract_name_from_blob(dec: bytes) -> str:
    """Extract cat name from a decompressed cat blob using primary+fallback parser."""
    _, _, name, _ = detect_name_end_and_sex(dec)
    if name.strip():
        return name

    fallback_name = fallback_name_from_fixed_layout(dec)
    if fallback_name is not None:
        _, _, name = fallback_name
        return name
    return ""


def resolve_name(name_lookup: Dict[int, str], key: int) -> str:
    if key <= 0:
        return ""
    return name_lookup.get(key, f"?key{key}")


def find_stats(dec: bytes, expected_off: int = 0x1CC, window: int = 0x140) -> Optional[Tuple[int, int, List[int]]]:
    """Find 7 base stats, returns (offset, [values...]) or None"""
    n = len(dec)
    best = None
    best_score = -1e18
    best_off = None

    lo = max(0, expected_off - window)
    hi = min(n - 28, expected_off + window)

    for off in range(lo, hi + 1):
        vals = struct.unpack_from("<7i", dec, off)
        if any(v < 1 or v > 7 for v in vals):
            continue
        dist = abs(off - expected_off)
        s = sum(vals)
        score = (1000 - dist) + (s * 0.1)
        if score > best_score:
            best_score = score
            best = vals
            best_off = off

    if best is None:
        return None
    return best_off, list(best)


def find_class_and_level(dec: bytes, name_end: int) -> Tuple[str, int, int, int]:
    """Find class, level and birthDay offsets"""
    cat_class = ""
    class_end = -1

    # Search entire blob after name_end
    search_start = name_end
    search_end = len(dec)
    print(f"DEBUG: Searching class between {search_start} ~ {search_end}, name_end={name_end}")

    for cls in CAT_CLASSES:
        cls_bytes = cls.encode("ascii")
        idx = dec.find(cls_bytes, search_start, search_end)
        if idx != -1:
            cat_class = cls
            class_end = idx + len(cls_bytes)
            print(f"DEBUG: Found class {cls!r} at offset {idx}")
            break
    else:
        print(f"DEBUG: No class found. Hex dump around name_end:")
        hex_start = max(0, name_end - 32)
        hex_end = min(len(dec), name_end + 256)
        for i in range(hex_start, hex_end, 16):
            hex_str = ' '.join(f'{b:02x}' for b in dec[i:i+16])
            ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in dec[i:i+16])
            print(f"  {i:04x}: {hex_str:<48} {ascii_str}")

    # Try fallback offsets first (seem more reliable)
    fallback_level_offset = len(dec) - 115
    fallback_birth_day_offset = len(dec) - 103
    fallback_level = u32_le(dec, fallback_level_offset) if fallback_level_offset + 4 <= len(dec) else 1
    fallback_birth_day = u32_le(dec, fallback_birth_day_offset) if fallback_birth_day_offset + 4 <= len(dec) else 0
    if fallback_birth_day > 2147483647:
        fallback_birth_day = 0

    print(f"DEBUG: fallback_level_offset={fallback_level_offset}, level={fallback_level}, birth_day={fallback_birth_day}")

    # Use fallback if level looks reasonable (1-100)
    if 1 <= fallback_level <= 100:
        level_offset = fallback_level_offset
        birth_day_offset = fallback_birth_day_offset
        level = fallback_level
        birth_day = fallback_birth_day
        print(f"DEBUG: Using fallback offsets (level {level} looks valid)")
    elif class_end > 0 and class_end + 32 <= len(dec):
        # Print hex dump around class to find structure
        print(f"DEBUG: Hex dump around class_end ({class_end}):")
        hex_start = class_end - 16
        hex_end = min(len(dec), class_end + 64)
        for i in range(hex_start, hex_end, 16):
            hex_str = ' '.join(f'{b:02x}' for b in dec[i:i+16])
            ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in dec[i:i+16])
            marker = " <-- class_end" if i <= class_end < i+16 else ""
            print(f"  {i:04x}: {hex_str:<48} {ascii_str}{marker}")

        level_offset = class_end
        birth_day_offset = class_end + 12
        level = u32_le(dec, level_offset) if level_offset + 4 <= len(dec) else 1
        birth_day = u32_le(dec, birth_day_offset) if birth_day_offset + 4 <= len(dec) else 0
        if birth_day > 2147483647:
            birth_day = 0
        print(f"DEBUG: Using class_end offsets, level={level}, birth_day={birth_day}")
    else:
        level_offset = fallback_level_offset
        birth_day_offset = fallback_birth_day_offset
        level = fallback_level
        birth_day = fallback_birth_day
        print(f"DEBUG: Using fallback offsets (no class found)")

    return cat_class, level, birth_day, level_offset, birth_day_offset


# T-array mutation slot mapping (idx -> field_name)
# T[0]=Body, T[1]=BodyFur, T[5]=Head, T[6]=HeadFur, etc.
MUTATION_SLOT_MAP = {
    0: "body",
    1: "bodyFur",
    5: "head",
    6: "headFur",
    10: "tail",
    11: "tailFur",
    15: "legL",
    16: "legLFur",
    20: "legR",
    21: "legRFur",
    25: "armL",
    26: "armLFur",
    30: "armR",
    31: "armRFur",
    35: "eyeL",
    36: "eyeLFur",
    40: "eyeR",
    41: "eyeRFur",
    45: "eyebrowL",
    46: "eyebrowLFur",
    50: "eyebrowR",
    51: "eyebrowRFur",
    55: "earL",
    56: "earLFur",
    60: "earR",
    61: "earRFur",
    65: "mouth",
    66: "mouthFur",
}


def read_t_array(dec: bytes, name_end: int) -> Dict[str, int]:
    """Read T-array mutations from cat blob. Returns {field_name: value, ...}"""
    mutations = {}
    t_start = name_end + 0x74

    for idx, field_name in MUTATION_SLOT_MAP.items():
        offset = t_start + idx * 4
        if offset + 4 > len(dec):
            continue
        val = u32_le(dec, offset)
        # Only include non-default values (>1)
        if val > 1:
            mutations[field_name] = val

    return mutations


def parse_abilities_and_mutations(dec: bytes, name_end: int = 0) -> Tuple[Dict[str, List[Optional[str]]], Dict[str, int]]:
    """Parse abilities and mutations from cat blob"""
    abilities: Dict[str, List[Optional[str]]] = {
        "active": [None] * 6,
        "passive": [None, None],
        "disorder": [None, None]
    }
    mutations = []

    n = len(dec)
    for start in range(0, n - 16):
        if start + 8 > n:
            break
        ln = u64_le(dec, start)
        if ln != 11 or start + 8 + ln > n:
            continue
        sb = dec[start + 8:start + 8 + ln]
        if sb != b"DefaultMove":
            continue

        items = []
        i = start
        for _ in range(64):
            if i + 8 > n:
                break

            ln = u64_le(dec, i)
            valid = True

            if ln < 0 or ln > 96 or i + 8 + ln > n:
                valid = False
            elif ln > 0:
                sb = dec[i + 8:i + 8 + ln]
                if b"\x00" in sb or any(c < 32 or c >= 127 for c in sb):
                    valid = False
                else:
                    try:
                        s = sb.decode("ascii")
                        if not s[0].isalpha() and not s[0].isdigit():
                            valid = False
                    except UnicodeDecodeError:
                        valid = False

            if not valid:
                if i + 4 <= n and dec[i:i+4] in (b'\x01\x00\x00\x00', b'\x02\x00\x00\x00'):
                    i += 4
                    continue
                break

            if ln == 0:
                i += 8
                continue

            sb = dec[i + 8:i + 8 + ln]
            s = sb.decode("ascii")
            items.append(s)
            i += 8 + ln

        # Active: items[0:6]
        for idx in range(6):
            if idx < len(items):
                val = items[idx]
                abilities["active"][idx] = val if val != "None" else None

        # Passive: items[10] and items[11]
        if len(items) > 10:
            val = items[10]
            abilities["passive"][0] = val if val != "None" else None
        if len(items) > 11:
            val = items[11]
            abilities["passive"][1] = val if val != "None" else None

        # Disorder: may come from items[12-13] (u64-run) or StringRec blocks
        disorder_from_run = []
        if len(items) > 12:
            val = items[12]
            if val and val != "None":
                disorder_from_run.append(val)
        if len(items) > 13:
            val = items[13]
            if val and val != "None":
                disorder_from_run.append(val)

        # If Disorder comes from u64-run, use it directly
        if disorder_from_run:
            abilities["disorder"][0] = disorder_from_run[0] if len(disorder_from_run) > 0 else None
            abilities["disorder"][1] = disorder_from_run[1] if len(disorder_from_run) > 1 else None

        # Check for secondary u64-run after separator (for Passive2)
        # Two possible formats:
        # 1. With separator: \x02\x00\x00\x00 + u64-run Passive2, then StringRec[0-1] = Disorder
        # 2. Without separator: StringRec[0] = Passive2, StringRec[1-2] = Disorder
        o = i
        has_separator = False
        if o + 4 <= n and dec[o:o+4] == b'\x02\x00\x00\x00':
            has_separator = True
            o += 4  # Skip separator
            if o + 8 <= n:
                ln = u64_le(dec, o)
                if 0 < ln <= 96 and o + 8 + ln <= n:
                    sb = dec[o + 8:o + 8 + ln]
                    try:
                        s = sb.decode("ascii")
                        if s and s != "None":
                            abilities["passive"][1] = s
                        o += 8 + ln
                    except UnicodeDecodeError:
                        pass

        # StringRec blocks: [\x01\x00\x00\x00][u64 len][ASCII string]
        sig = b"\x01\x00\x00\x00"
        stringrec_idx = 0
        disorder_idx = 0
        for _ in range(4):
            if o + 12 > n:
                break
            if dec[o:o+4] != sig:
                break
            ln = u64_le(dec, o + 4)
            if ln < 0 or ln > 96 or o + 12 + ln > n:
                break
            sb = dec[o + 12:o + 12 + ln]
            try:
                s = sb.decode("ascii")
                val = s if s != "None" and s != "" else None

                # If we had separator, all StringRec are disorders
                # If no separator, StringRec[0] is Passive2, [1-2] are disorders
                if has_separator:
                    # All StringRec are disorders
                    if disorder_idx < 2:
                        abilities["disorder"][disorder_idx] = val
                    disorder_idx += 1
                else:
                    # No separator: StringRec[0] = Passive2, [1-2] = Disorder
                    if stringrec_idx == 0:
                        abilities["passive"][1] = val
                    elif stringrec_idx <= 2:
                        abilities["disorder"][stringrec_idx - 1] = val
                    stringrec_idx += 1

                o += 12 + ln
            except UnicodeDecodeError:
                break

        # Parse mutations using T-array
        mutations = read_t_array(dec, name_end) if name_end > 0 else {}

        return abilities, mutations

    # Parse mutations even if abilities not found
    mutations = read_t_array(dec, name_end) if name_end > 0 else {}
    return abilities, mutations


def parse_save_file(data: bytes) -> Dict[str, Any]:
    """Parse entire save file from bytes"""
    conn = sqlite3.connect(":memory:")
    conn.deserialize(data)
    script_start_time = datetime.datetime.now().replace(microsecond=0).isoformat()

    # Read current_day
    current_day = 0
    props = conn.execute("SELECT key, data FROM properties WHERE key = 'current_day'")
    basic_data = {
        "current_day": 0,
    }
    for row in props.fetchall():
        key, raw_data = row
        if isinstance(raw_data, int):
            val = raw_data
        elif isinstance(raw_data, (bytes, memoryview)):
            raw_bytes = to_bytes(raw_data)
            # Try to parse as ASCII string first (newer save format)
            try:
                val = int(raw_bytes.decode("ascii"))
            except (ValueError, UnicodeDecodeError):
                # Fall back to binary format (older save format)
                if len(raw_bytes) == 8:
                    val = struct.unpack("<q", raw_bytes)[0]
                elif len(raw_bytes) == 4:
                    val = struct.unpack("<i", raw_bytes)[0]
                else:
                    val = 0
        else:
            val = 0
        if key == 'current_day':
            basic_data["current_day"] = val
            current_day = val

    # Read house_state
    hs_row = conn.execute("SELECT data FROM files WHERE key='house_state'").fetchone()
    house_cats = parse_house_state(to_bytes(hs_row[0])) if hs_row and hs_row[0] else []

    # Read adventure_state
    adv_row = conn.execute("SELECT data FROM files WHERE key='adventure_state'").fetchone()
    adv_keys = parse_adventure_state(to_bytes(adv_row[0])) if adv_row and adv_row[0] else []

    # Merge keys
    all_keys = {key: room for key, room in house_cats}
    for key in adv_keys:
        if key not in all_keys:
            all_keys[key] = "(ADVENTURE)"

    # Read pedigree and parent relationships
    parent_map: Dict[int, Tuple[int, int]] = {}
    pedigree_row = conn.execute("SELECT data FROM files WHERE key='pedigree'").fetchone()
    pedigree_blob = to_bytes(pedigree_row[0]) if pedigree_row and pedigree_row[0] else b""
    if pedigree_blob:
        max_key_row = conn.execute("SELECT key FROM cats ORDER BY key DESC LIMIT 1").fetchone()
        max_cat_key = int(max_key_row[0]) if max_key_row and max_key_row[0] is not None else 0
        if max_cat_key > 0:
            parent_map = parse_pedigree(pedigree_blob, max_cat_key)

    # Parse each cat
    cats = []
    for key, room in sorted(all_keys.items()):
        row = conn.execute("SELECT data FROM cats WHERE key=?", (key,)).fetchone()
        if not row or row[0] is None:
            continue

        # Ensure BLOB data is bytes (Pyodide may return memoryview)
        wrapped = to_bytes(row[0])
        try:
            dec, variant = decompress_cat_blob(wrapped)

            if len(dec) < 12:
                continue

            id64 = u64_le(dec, 4)
            name_len, name_end, name, _ = detect_name_end_and_sex(dec)
            if not name.strip():
                fallback_name = fallback_name_from_fixed_layout(dec)
                if fallback_name is not None:
                    name_len, name_end, name = fallback_name
                    print(f"DEBUG: Cat {key} - fallback name parser used, name={name!r}")
            sex = read_sex_from_tag(dec, name_end)
            retired, dead, donated = read_status_flags(dec, name_end)
            cat_class, level, birth_day_fallback, level_off, birth_day_off = find_class_and_level(dec, name_end)
            print(f"DEBUG: Cat {key} - name={name}, cat_class={cat_class!r}, level={level}")

            _, birthday_day, _ = find_birthday_info(dec, current_day)
            birth_day = int(birthday_day) if birthday_day is not None else int(birth_day_fallback)
            age = max(0, current_day - birth_day)

            stats_result = find_stats(dec)
            if stats_result:
                stats_off, stats_values = stats_result
                stats = {
                    "STR": stats_values[0],
                    "DEX": stats_values[1],
                    "CON": stats_values[2],
                    "INT": stats_values[3],
                    "SPD": stats_values[4],
                    "CHA": stats_values[5],
                    "LCK": stats_values[6]
                }
            else:
                stats = {"STR": 5, "DEX": 5, "CON": 5, "INT": 5, "SPD": 5, "CHA": 5, "LCK": 5}
                stats_off = -1

            abilities, mutations = parse_abilities_and_mutations(dec, name_end)
            social = parse_social_fields(dec, name_end)

            parent1_key, parent2_key = parent_map.get(key, (-1, -1))
            if parent1_key > 0 and parent1_key == parent2_key:
                parent2_key = -1

            gp_keys: List[int] = []
            for parent_key in [parent1_key, parent2_key]:
                if parent_key > 0:
                    gp1, gp2 = parent_map.get(parent_key, (-1, -1))
                    gp_keys.extend([gp1, gp2])
                else:
                    gp_keys.extend([-1, -1])

            # Ensure arrays have correct lengths
            active = abilities["active"] + [""] * (6 - len(abilities["active"]))
            active = active[:6]
            passive = abilities["passive"] + [""] * (2 - len(abilities["passive"]))
            passive = passive[:2]
            disorder = abilities["disorder"] + [""] * (2 - len(abilities["disorder"]))
            disorder = disorder[:2]

            cats.append({
                "key": key,
                "id64": id64,
                "name": name,
                "sex": sex,
                "age": age,
                "level": level,
                "class": cat_class,
                "retired": retired,
                "dead": dead,
                "donated": donated,
                "stats": stats,
                "abilities": {
                    "active": active,
                    "passive": passive,
                    "disorder": disorder
                },
                "mutations": mutations,
                "icon": social["icon"],
                "libido": social["libido"],
                "libido_raw": round(social["libido_raw"], 4),
                "aggression": social["aggression"],
                "aggression_raw": round(social["aggression_raw"], 4),
                "room": room,
                "genealogy": {
                    "stray": (parent1_key <= 0 and parent2_key <= 0),
                    "parent1": "",
                    "parent2": "",
                    "grandparent1": "",
                    "grandparent2": "",
                    "grandparent3": "",
                    "grandparent4": "",
                },
                # Internal fields for saving
                "_variant": variant,
                "_name_len": name_len,
                "_name_end": name_end,
                "_level_offset": level_off,
                "_birth_day_offset": birth_day_off,
                "_stats_offset": stats_off,
                "_birth_day": birth_day,
                "_loves_key": social["loves_key"],
                "_hates_key": social["hates_key"],
                "_parent1_key": parent1_key,
                "_parent2_key": parent2_key,
                "_grandparent_keys": gp_keys,
            })
        except Exception as e:
            print(f"Error parsing cat {key}: {e}")
            continue

    # Build name lookup from parsed cats
    name_lookup: Dict[int, str] = {}
    for cat in cats:
        if cat["name"].strip():
            name_lookup[cat["key"]] = cat["name"]

    # Resolve extra keys needed for loves/hates/lineage names
    needed_keys = set()
    for cat in cats:
        lk = int(cat.get("_loves_key", -1))
        hk = int(cat.get("_hates_key", -1))
        p1 = int(cat.get("_parent1_key", -1))
        p2 = int(cat.get("_parent2_key", -1))
        gks = cat.get("_grandparent_keys", [])

        if lk > 0:
            needed_keys.add(lk)
        if hk > 0:
            needed_keys.add(hk)
        if p1 > 0:
            needed_keys.add(p1)
        if p2 > 0:
            needed_keys.add(p2)
        for gk in gks:
            if int(gk) > 0:
                needed_keys.add(int(gk))

    missing_keys = [k for k in needed_keys if k not in name_lookup]
    if missing_keys:
        placeholders = ",".join("?" for _ in missing_keys)
        query = f"SELECT key, data FROM cats WHERE key IN ({placeholders})"
        for rel_key, raw_blob in conn.execute(query, missing_keys).fetchall():
            if raw_blob is None:
                continue
            try:
                rel_dec, _ = decompress_cat_blob(to_bytes(raw_blob))
                rel_name = extract_name_from_blob(rel_dec)
                if rel_name.strip():
                    name_lookup[int(rel_key)] = rel_name
            except Exception:
                continue

    # Materialize loves/hates and lineage names
    for cat in cats:
        loves_key = int(cat.get("_loves_key", -1))
        hates_key = int(cat.get("_hates_key", -1))
        parent1_key = int(cat.get("_parent1_key", -1))
        parent2_key = int(cat.get("_parent2_key", -1))
        gp_keys = cat.get("_grandparent_keys", [-1, -1, -1, -1])
        genealogy = cat.get("genealogy", {})

        cat["loves"] = resolve_name(name_lookup, loves_key)
        cat["hates"] = resolve_name(name_lookup, hates_key)
        genealogy["parent1"] = resolve_name(name_lookup, parent1_key)
        genealogy["parent2"] = resolve_name(name_lookup, parent2_key)
        genealogy["grandparent1"] = resolve_name(name_lookup, int(gp_keys[0]) if len(gp_keys) > 0 else -1)
        genealogy["grandparent2"] = resolve_name(name_lookup, int(gp_keys[1]) if len(gp_keys) > 1 else -1)
        genealogy["grandparent3"] = resolve_name(name_lookup, int(gp_keys[2]) if len(gp_keys) > 2 else -1)
        genealogy["grandparent4"] = resolve_name(name_lookup, int(gp_keys[3]) if len(gp_keys) > 3 else -1)
        cat["genealogy"] = genealogy

        cat.pop("_loves_key", None)
        cat.pop("_hates_key", None)
        cat.pop("_parent1_key", None)
        cat.pop("_parent2_key", None)
        cat.pop("_grandparent_keys", None)

    conn.close()

    return {
        "basic": basic_data,
        "script_start_time": script_start_time,
        "cats": cats,
    }


# Export functions for JavaScript bridge
def parse_save(data_bytes: bytes) -> str:
    """Parse save file and return JSON string"""
    result = parse_save_file(data_bytes)
    return json.dumps(result)


# Usage:
#   python parse_save.py steamcampaign01.sav -o mewgenics_save.json
#   python parse_save.py steamcampaign01.sav -o mewgenics_save.json --quiet
def _run_cli() -> None:
    """CLI entrypoint for local Python usage."""
    parser = argparse.ArgumentParser(description="Parse a Mewgenics .sav file and output JSON")
    parser.add_argument(
        "input",
        nargs="?",
        default="steamcampaign01.sav",
        help="Path to input save file (default: steamcampaign01.sav)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="mewgenics_save.json",
        help="Path to output JSON file (default: mewgenics_save.json)",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Suppress debug/output logs",
    )

    args = parser.parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        parser.error(f"Input file not found: {input_path}")

    if args.quiet:
        with contextlib.redirect_stdout(io.StringIO()):
            result = parse_save_file(input_path.read_bytes())
    else:
        result = parse_save_file(input_path.read_bytes())

    output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    if not args.quiet:
        print(f"Parsed save: {input_path.resolve()}")
        print(f"Wrote JSON:  {output_path.resolve()}")


if __name__ == "__main__" and sys.platform != "emscripten":
    _run_cli()
