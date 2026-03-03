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


def lz4_compress_block(src: bytes) -> bytes:
    """Simple LZ4 block compression"""
    dst = bytearray()
    src_pos = 0
    src_len = len(src)

    while src_pos < src_len:
        # Find match (simple greedy approach)
        best_len = 0
        best_off = 0
        max_match = min(src_len - src_pos, 0xFFFF)
        search_start = max(0, src_pos - 0xFFFF)

        for off in range(1, min(src_pos - search_start + 1, 0xFFFF)):
            match_len = 0
            while (match_len < max_match and
                   src_pos + match_len < src_len and
                   src[src_pos + match_len] == src[src_pos - off + match_len]):
                match_len += 1
            if match_len > best_len and match_len >= 4:
                best_len = match_len
                best_off = off

        # Determine literal length
        if best_len >= 4:
            literal_len = 0
        else:
            literal_len = min(src_len - src_pos, src_len)
            best_len = 0

        literal_len = min(literal_len, src_len - src_pos)

        # Write token
        lit_field = min(literal_len, 15)
        match_field = 0 if best_len < 4 else min(best_len - 4, 15)
        dst.append((lit_field << 4) | match_field)

        # Write literal length extension
        if literal_len >= 15:
            remaining = literal_len - 15
            while remaining >= 255:
                dst.append(255)
                remaining -= 255
            dst.append(remaining)

        # Write literals
        for i in range(literal_len):
            dst.append(src[src_pos + i])
        src_pos += literal_len

        # Write match
        if best_len >= 4 and src_pos < src_len:
            dst.append(best_off & 0xFF)
            dst.append((best_off >> 8) & 0xFF)
            src_pos += best_len

            # Write match length extension
            if best_len - 4 >= 15:
                remaining = best_len - 4 - 15
                while remaining >= 255:
                    dst.append(255)
                    remaining -= 255
                dst.append(remaining)

    return bytes(dst)


# Binary helpers
def u16_le(b: bytes, off: int) -> int:
    return struct.unpack_from("<H", b, off)[0]


def u32_le(b: bytes, off: int) -> int:
    return struct.unpack_from("<I", b, off)[0]


def u64_le(b: bytes, off: int) -> int:
    return struct.unpack_from("<Q", b, off)[0]


def f64_le(b: bytes, off: int) -> float:
    return struct.unpack_from("<d", b, off)[0]


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


def recompress_cat_blob(dec: bytes, variant: str) -> bytes:
    """Recompress cat BLOB"""
    comp = lz4_compress_block(dec)
    if variant == "A":
        return struct.pack("<I", len(dec)) + comp
    return struct.pack("<I", len(dec)) + struct.pack("<I", len(comp)) + comp


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


def write_abilities_to_blob(dec_mut: bytearray, abilities: Dict[str, List[str]]) -> bool:
    """Write abilities back to blob by rebuilding the structure. Returns True if successful."""
    n = len(dec_mut)

    # Find u64-run starting with "DefaultMove"
    for start in range(0, n - 16):
        if start + 8 > n:
            break
        ln = u64_le(dec_mut, start)
        if ln != 11 or start + 8 + ln > n:
            continue
        sb = bytes(dec_mut[start + 8:start + 8 + ln])
        if sb != b"DefaultMove":
            continue

        # Found the run, now parse all abilities
        items = []
        i = start

        # Parse u64-run items
        for _ in range(64):
            if i + 8 > n:
                break
            ln = u64_le(dec_mut, i)

            # Validate
            if ln < 0 or ln > 96 or i + 8 + ln > n:
                # Check if it's a StringRec marker
                if i + 4 <= n and bytes(dec_mut[i:i+4]) in (b'\x01\x00\x00\x00', b'\x02\x00\x00\x00'):
                    break
                break

            if ln == 0:
                items.append(("u64", i, 0, ""))
                i += 8
                continue

            sb = bytes(dec_mut[i + 8:i + 8 + ln])
            try:
                s = sb.decode("ascii")
                items.append(("u64", i, ln, s))
            except UnicodeDecodeError:
                break
            i += 8 + ln

        # Check for separator and secondary u64-run (Passive2)
        has_separator = False
        o = i
        if o + 4 <= n and bytes(dec_mut[o:o+4]) == b'\x02\x00\x00\x00':
            has_separator = True
            o += 4
            if o + 8 <= n:
                ln = u64_le(dec_mut, o)
                if 0 < ln <= 96 and o + 8 + ln <= n:
                    o += 8 + ln

        # Parse StringRec blocks
        stringrec_items = []
        disorder_start = i  # Start from original position for size calculation
        sig = b"\x01\x00\x00\x00"
        for _ in range(4):
            if o + 12 > n:
                break
            if bytes(dec_mut[o:o+4]) != sig:
                break
            ln = u64_le(dec_mut, o + 4)
            if ln < 0 or ln > 96 or o + 12 + ln > n:
                break
            sb = bytes(dec_mut[o + 12:o + 12 + ln])
            try:
                s = sb.decode("ascii")
                stringrec_items.append(("strrec", o, ln, s))
            except UnicodeDecodeError:
                break
            o += 12 + ln

        # Get new ability values
        active = abilities.get("active", [])
        passive = abilities.get("passive", [])
        disorder = abilities.get("disorder", [])

        # Build new u64-run section
        new_u64_data = bytearray()
        for idx in range(len(items)):
            orig_type, orig_pos, orig_len, orig_val = items[idx]

            # Determine new value based on position
            new_val = None
            if idx < 6 and idx < len(active) and active[idx]:  # Active 0-5
                new_val = active[idx]
            elif idx == 10 and len(passive) > 0 and passive[0]:  # Passive 1
                new_val = passive[0]
            elif idx == 11 and len(passive) > 1 and passive[1]:  # Passive 2
                new_val = passive[1]
            else:
                new_val = orig_val

            # Encode value: [u64 len][bytes]
            if new_val:
                val_bytes = new_val.encode("ascii")
                new_u64_data.extend(struct.pack("<Q", len(val_bytes)))
                new_u64_data.extend(val_bytes)
            else:
                # Empty string
                new_u64_data.extend(struct.pack("<Q", 0))

        # Build new separator + secondary u64-run if needed
        new_separator_data = bytearray()
        if has_separator:
            new_separator_data.extend(b'\x02\x00\x00\x00')
            # Passive2 from u64-run items[11] (already encoded above)
            # We don't need to add anything here since Passive2 is in the u64-run

        # Build new StringRec section
        # Need to handle two formats:
        # 1. With separator: StringRec[0-1] = Disorder
        # 2. Without separator: StringRec[0] = Passive2, StringRec[1-2] = Disorder
        new_strrec_data = bytearray()
        for idx in range(len(stringrec_items)):
            orig_type, orig_pos, orig_len, orig_val = stringrec_items[idx]

            # Determine new value based on format
            new_val = None
            if has_separator:
                # With separator: all StringRec are disorders
                if idx < len(disorder):
                    # Use provided value (even if empty) to allow clearing
                    new_val = disorder[idx] if disorder[idx] else None
                else:
                    new_val = orig_val
            else:
                # Without separator: StringRec[0] = Passive2, [1-2] = Disorder
                if idx == 0:
                    # Passive2
                    if len(passive) > 1:
                        new_val = passive[1] if passive[1] else None
                    else:
                        new_val = orig_val
                elif idx <= 2:
                    # Disorder[idx-1]
                    disorder_idx = idx - 1
                    if disorder_idx < len(disorder):
                        new_val = disorder[disorder_idx] if disorder[disorder_idx] else None
                    else:
                        new_val = orig_val
                else:
                    new_val = orig_val

            # Encode value: [u32=1][u64 len][bytes]
            new_strrec_data.extend(b'\x01\x00\x00\x00')
            # Game stores "None" string for empty slots, not empty string
            val_to_write = new_val if new_val else "None"
            val_bytes = val_to_write.encode("ascii")
            new_strrec_data.extend(struct.pack("<Q", len(val_bytes)))
            new_strrec_data.extend(val_bytes)

        # Calculate size difference
        old_section_len = disorder_start - start
        new_section_len = len(new_u64_data) + len(new_separator_data) + len(new_strrec_data)
        size_diff = new_section_len - old_section_len

        # Build new blob: [prefix][new_abilities][suffix]
        # prefix = everything before the u64-run
        # suffix = everything after the StringRec section

        prefix = bytes(dec_mut[0:start])
        suffix_start = disorder_start + sum(12 + orig_len for _, _, orig_len, _ in stringrec_items)
        suffix = bytes(dec_mut[suffix_start:])

        new_dec = bytearray(prefix)
        new_dec.extend(new_u64_data)
        new_dec.extend(new_separator_data)
        new_dec.extend(new_strrec_data)
        new_dec.extend(suffix)

        # Replace dec_mut contents
        dec_mut[:] = new_dec
        return True

    return False


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


def write_t_array(dec_mut: bytearray, name_end: int, mutations: Dict[str, int]) -> bool:
    """Write T-array mutations to cat blob. Returns True if successful."""
    t_start = name_end + 0x74

    # Build reverse mapping: field_name -> idx
    for idx, field_name in MUTATION_SLOT_MAP.items():
        offset = t_start + idx * 4
        if offset + 4 > len(dec_mut):
            continue

        # If this mutation is in the changes, write it
        if field_name in mutations:
            val = mutations[field_name]
            struct.pack_into("<I", dec_mut, offset, val)

    return True


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


def parse_furniture_data(conn: sqlite3.Connection) -> Dict[str, List[Dict[str, Any]]]:
    """Parse furniture data from database and categorize by status.

    Returns:
        Dict with keys:
        - 'backpack': Furniture with no room assigned (in backpack)
        - 'placed': Furniture placed in rooms (has coordinates)
        - 'unplaced': Furniture assigned to room but not placed (no coordinates)

    Furniture BLOB structure:
    - u32 uncomp_len (=1, meaning minimal compressed data)
    - u32 comp_len
    - null-terminated furniture_id string (e.g., "set_wooden_lamp")
    - padding zeros
    - u64 room_name_len
    - room_name string (e.g., "Floor2_Large")
    - position data (x, y as i32)
    """
    result = {
        "backpack": [],    # room is None/empty
        "placed": [],      # room exists and has coordinates
        "unplaced": [],    # room exists but no coordinates
    }

    def read_null_terminated(data: bytes, start: int) -> tuple:
        """Read null-terminated ASCII string, return (string, next_offset)"""
        end = start
        while end < len(data) and data[end] != 0:
            end += 1
        if end > start:
            return data[start:end].decode('ascii', errors='replace'), end + 1
        return "", end + 1

    try:
        cursor = conn.execute("SELECT key, data FROM furniture")
        for row in cursor.fetchall():
            key = row[0]
            data = to_bytes(row[1])

            if not data or len(data) < 16:
                continue

            try:
                # Skip header
                offset = 8

                # Skip any zero bytes before furniture_id
                while offset < len(data) and data[offset] == 0:
                    offset += 1

                # Read furniture ID (null-terminated)
                furniture_id, offset = read_null_terminated(data, offset)

                # Check if this is backpack furniture (no room)
                # Skip null and padding, then check if next value is room_len (small) or coordinates (huge)
                check_offset = offset
                while check_offset < len(data) and data[check_offset] == 0:
                    check_offset += 1

                # Read room name if exists (u64 length prefix + string)
                room = None
                if check_offset + 8 <= len(data):
                    room_len = u64_le(data, check_offset)
                    # If room_len is a small value (1-100), it's a valid room name length
                    # If room_len is 0 or huge, it's coordinates (backpack furniture)
                    if 0 < room_len < 64 and check_offset + 8 + room_len <= len(data):
                        room = data[check_offset + 8:check_offset + 8 + room_len].decode('ascii', errors='replace')
                        offset = check_offset + 8 + room_len

                # Look for position data
                x, y = None, None
                # For backpack furniture (no room), coordinates are at check_offset
                # For placed furniture, search after room name
                if room is None:
                    # Backpack: coordinates directly at check_offset
                    if check_offset + 8 <= len(data):
                        x = struct.unpack_from("<i", data, check_offset)[0]
                        y = struct.unpack_from("<i", data, check_offset + 4)[0]
                        if not (-1000 <= x <= 1000 and -1000 <= y <= 1000):
                            x, y = None, None
                else:
                    # Placed: search for coordinates after room
                    for i in range(offset, min(len(data) - 8, offset + 100)):
                        if i % 4 != 0:
                            continue
                        val1 = struct.unpack_from("<i", data, i)[0]
                        val2 = struct.unpack_from("<i", data, i + 4)[0]
                        if -1000 <= val1 <= 1000 and -1000 <= val2 <= 1000:
                            x, y = val1, val2
                            break

                furniture = {
                    "key": key,
                    "furniture_id": furniture_id or "unknown",
                }

                if x is not None:
                    furniture["x"] = x
                if y is not None:
                    furniture["y"] = y

                # Categorize based on room and position
                if room is None or room == "":
                    # In backpack (no room assigned)
                    furniture["room"] = None
                    result["backpack"].append(furniture)
                elif x is not None and y is not None:
                    # Placed in room
                    furniture["room"] = room
                    result["placed"].append(furniture)
                else:
                    # Assigned to room but not placed
                    furniture["room"] = room
                    result["unplaced"].append(furniture)

            except Exception as e:
                print(f"Error parsing furniture {key}: {e}")
                result["backpack"].append({
                    "key": key,
                    "error": str(e),
                })
                continue

    except Exception as e:
        print(f"Error reading furniture table: {e}")

    return result


def parse_save_file(data: bytes) -> Dict[str, Any]:
    """Parse entire save file from bytes"""
    conn = sqlite3.connect(":memory:")
    conn.deserialize(data)

    # Read current_day
    current_day = 0
    props = conn.execute("SELECT key, data FROM properties WHERE key IN ('current_day', 'house_gold', 'house_food', 'save_file_percent')")
    basic_data = {
        "current_day": 0,
        "house_gold": 0,
        "house_food": 0,
        "save_percent": 0
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
        elif key == 'house_gold':
            basic_data["house_gold"] = val
        elif key == 'house_food':
            basic_data["house_food"] = val
        elif key == 'save_file_percent':
            basic_data["save_percent"] = val

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
            name_len, name_end, name, sex = detect_name_end_and_sex(dec)
            retired, dead, donated = read_status_flags(dec, name_end)
            cat_class, level, birth_day, level_off, birth_day_off = find_class_and_level(dec, name_end)
            print(f"DEBUG: Cat {key} - name={name}, cat_class={cat_class!r}, level={level}")
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
                    "LUCK": stats_values[6]
                }
            else:
                stats = {"STR": 5, "DEX": 5, "CON": 5, "INT": 5, "SPD": 5, "CHA": 5, "LUCK": 5}
                stats_off = -1

            abilities, mutations = parse_abilities_and_mutations(dec, name_end)

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
                "room": room,
                # Internal fields for saving
                "_variant": variant,
                "_name_len": name_len,
                "_name_end": name_end,
                "_level_offset": level_off,
                "_birth_day_offset": birth_day_off,
                "_stats_offset": stats_off,
                "_birth_day": birth_day
            })
        except Exception as e:
            print(f"Error parsing cat {key}: {e}")
            continue

    # Read furniture data
    furniture_data = parse_furniture_data(conn)

    conn.close()

    return {
        "basic": basic_data,
        "cats": cats,
        "furniture": furniture_data,
        "total_cats": len(cats),
        "total_furniture": len(furniture_data.get("placed", [])) + len(furniture_data.get("unplaced", [])) + len(furniture_data.get("backpack", []))
    }


def modify_save_file(data: bytes, modified_basic: Dict[str, int], cat_changes: Dict[int, Dict[str, Any]], furniture_changes: Optional[Dict[str, Any]] = None, output_path: str = "/tmp/mewgenics_modified.sav") -> str:
    """Modify save file with changes and save to Pyodide virtual FS, return output path"""
    # Ensure data is bytes (Pyodide may pass memoryview)
    if not isinstance(data, bytes):
        data = bytes(data)

    conn = sqlite3.connect(":memory:")
    conn.deserialize(data)

    # Apply furniture changes
    if furniture_changes:
        added = furniture_changes.get("added", [])
        removed = furniture_changes.get("removed", [])

        # Remove furniture by key
        for key in removed:
            conn.execute("DELETE FROM furniture WHERE key = ?", (key,))
            print(f"DEBUG: Removed furniture key={key}")

        # Add new furniture
        for furn in added:
            key = furn.get("key")
            furniture_id = furn.get("furniture_id")
            x = furn.get("x", 256)
            y = furn.get("y", 256)
            room = furn.get("room")

            # Check if this is a replacement for an existing row
            existing = conn.execute("SELECT key FROM furniture WHERE key = ?", (key,)).fetchone()
            if existing:
                conn.execute("DELETE FROM furniture WHERE key = ?", (key,))

            # Build furniture BLOB for backpack furniture
            # Structure based on add_furniture.py reference:
            # - u32 uncomp_len = 1
            # - u32 comp_len = len(furniture_id) (without null)
            # - padding (4 bytes)
            # - furniture_id (null-terminated)
            # - padding (28 bytes fixed)
            # - i32 x, i32 y
            # - trailing: u32(1), u32(1)
            fid_bytes = furniture_id.encode('ascii')
            comp_len = len(fid_bytes)

            blob_data = bytearray()
            # Header
            blob_data.extend(struct.pack('<I', 1))  # uncomp_len = 1
            blob_data.extend(struct.pack('<I', comp_len))  # comp_len
            # Padding (4 bytes)
            blob_data.extend(b'\x00\x00\x00\x00')
            # Furniture ID (null-terminated)
            blob_data.extend(fid_bytes)
            blob_data.append(0)
            # Padding (28 bytes fixed)
            blob_data.extend(b'\x00' * 28)
            # Coordinates
            blob_data.extend(struct.pack('<i', x))
            blob_data.extend(struct.pack('<i', y))
            # Trailing data
            blob_data.extend(struct.pack('<I', 1))
            blob_data.extend(struct.pack('<I', 1))

            conn.execute(
                "INSERT INTO furniture (key, data) VALUES (?, ?)",
                (key, sqlite3.Binary(bytes(blob_data)))
            )
            print(f"DEBUG: Added furniture key={key}, id={furniture_id}, x={x}, y={y}, room=None")

    # Update basic data - values are stored as ASCII strings in the save file
    if "current_day" in modified_basic:
        day_data = str(modified_basic["current_day"]).encode("ascii")
        conn.execute("UPDATE properties SET data = ? WHERE key = 'current_day'", (sqlite3.Binary(day_data),))

    if "house_gold" in modified_basic:
        gold_data = str(modified_basic["house_gold"]).encode("ascii")
        conn.execute("UPDATE properties SET data = ? WHERE key = 'house_gold'", (sqlite3.Binary(gold_data),))

    if "house_food" in modified_basic:
        food_data = str(modified_basic["house_food"]).encode("ascii")
        conn.execute("UPDATE properties SET data = ? WHERE key = 'house_food'", (sqlite3.Binary(food_data),))

    if "save_percent" in modified_basic:
        percent_data = str(modified_basic["save_percent"]).encode("ascii")
        conn.execute("UPDATE properties SET data = ? WHERE key = 'save_file_percent'", (sqlite3.Binary(percent_data),))

    # Apply cat changes
    for cat_key_str, changes in cat_changes.items():
        # JSON keys are strings, convert to int
        cat_key = int(cat_key_str)
        print(f"DEBUG: Processing cat {cat_key}, changes={changes}")
        row = conn.execute("SELECT data FROM cats WHERE key=?", (cat_key,)).fetchone()
        if not row or row[0] is None:
            continue

        # Ensure BLOB data is bytes (Pyodide may return memoryview)
        wrapped = to_bytes(row[0])
        try:
            dec, variant = decompress_cat_blob(wrapped)
            dec_mut = bytearray(dec)

            # Get offsets from changes or defaults
            name_end = changes.get("_name_end", 0x14)
            level_offset = changes.get("_level_offset", len(dec) - 115)
            birth_day_offset = changes.get("_birth_day_offset", len(dec) - 103)
            stats_offset = changes.get("_stats_offset", -1)
            birth_day = changes.get("_birth_day", 0)
            current_day = changes.get("_current_day", 0)

            # Modify name
            if "name" in changes and name_end > 0:
                name_len = (name_end - 0x14) // 2
                new_name = changes["name"][:32]
                new_name_bytes = new_name.encode("utf-16le")
                old_name_len_bytes = name_len * 2
                if len(new_name_bytes) <= old_name_len_bytes:
                    name_start = 0x14
                    for i in range(old_name_len_bytes):
                        dec_mut[name_start + i] = new_name_bytes[i] if i < len(new_name_bytes) else 0

            # Modify sex
            if "sex" in changes:
                sex_map = {"Male": 0, "Female": 1, "Ditto": 2}
                sex_value = sex_map.get(changes["sex"], 0)
                off_a = name_end + 8
                off_b = name_end + 12
                if off_b + 2 <= len(dec_mut):
                    dec_mut[off_a] = sex_value
                    dec_mut[off_a + 1] = 0
                    dec_mut[off_b] = sex_value
                    dec_mut[off_b + 1] = 0

            # Modify age (via birthDay)
            if "age" in changes and birth_day_offset >= 0:
                new_birth_day = max(0, current_day - changes["age"])
                struct.pack_into("<I", dec_mut, birth_day_offset, new_birth_day)

            # Modify retired status
            if "retired" in changes:
                flags_off = name_end + 0x10
                if flags_off + 2 <= len(dec_mut):
                    flags = u16_le(bytes(dec_mut), flags_off)
                    if changes["retired"]:
                        flags |= 0x0002
                    else:
                        flags &= ~0x0002
                    struct.pack_into("<H", dec_mut, flags_off, flags)

            # Modify stats
            if "stats" in changes and stats_offset >= 0:
                stats = changes["stats"]
                struct.pack_into("<7i", dec_mut, stats_offset,
                    stats.get("STR", 5),
                    stats.get("DEX", 5),
                    stats.get("CON", 5),
                    stats.get("INT", 5),
                    stats.get("SPD", 5),
                    stats.get("CHA", 5),
                    stats.get("LUCK", 5)
                )

            # Modify level
            if "level" in changes and level_offset >= 0:
                struct.pack_into("<I", dec_mut, level_offset, changes["level"])

            # Modify abilities
            if "abilities" in changes:
                abilities = changes["abilities"]
                write_abilities_to_blob(dec_mut, abilities)

            # Modify mutations
            if "mutations" in changes:
                mutations = changes["mutations"]
                write_t_array(dec_mut, name_end, mutations)

            # Re-compress and save
            new_wrapped = recompress_cat_blob(bytes(dec_mut), variant)
            # Use sqlite3.Binary to ensure proper BLOB handling in Pyodide
            conn.execute("UPDATE cats SET data = ? WHERE key = ?", (sqlite3.Binary(new_wrapped), cat_key))
            print(f"DEBUG: Updated cat {cat_key}, variant={variant}")

        except Exception as e:
            print(f"DEBUG: Error modifying cat {cat_key}: {e}")
            continue

    # Serialize database - Pyodide sqlite3 doesn't support serialize()
    # Use backup to Pyodide virtual file system, JS will read via pyodide.FS.readFile
    conn.commit()

    # Backup to virtual FS path that JS can access
    file_conn = sqlite3.connect(output_path)
    with file_conn:
        conn.backup(file_conn)
    file_conn.close()

    # Close original connection
    conn.close()

    # Return the output path for JS to read
    return output_path


# Export functions for JavaScript bridge
def parse_save(data_bytes: bytes) -> str:
    """Parse save file and return JSON string"""
    result = parse_save_file(data_bytes)
    return json.dumps(result)


def modify_save(data_bytes: bytes, modified_basic_json: str, cat_changes_json: str, furniture_changes_json: str = "{\"added\": [], \"removed\": []}", output_path: str = "/tmp/mewgenics_modified.sav") -> str:
    """Modify save file with JSON changes and save to virtual FS, return output path"""
    modified_basic = json.loads(modified_basic_json)
    cat_changes = json.loads(cat_changes_json)
    furniture_changes = json.loads(furniture_changes_json)

    # Debug: print received changes
    print(f"DEBUG: modified_basic = {modified_basic}")
    print(f"DEBUG: cat_changes keys = {list(cat_changes.keys())}")
    for k, v in cat_changes.items():
        print(f"DEBUG: cat_changes[{k}] = {v}")
    print(f"DEBUG: furniture_changes = {furniture_changes}")

    return modify_save_file(data_bytes, modified_basic, cat_changes, furniture_changes, output_path)


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


if __name__ == "__main__":
    _run_cli()
