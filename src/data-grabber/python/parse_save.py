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
            if not name.strip():
                fallback_name = fallback_name_from_fixed_layout(dec)
                if fallback_name is not None:
                    name_len, name_end, name = fallback_name
                    print(f"DEBUG: Cat {key} - fallback name parser used, name={name!r}")
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
                "_birth_day": birth_day,
            })
        except Exception as e:
            print(f"Error parsing cat {key}: {e}")
            continue

    conn.close()

    return {
        "basic": basic_data,
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


if __name__ == "__main__":
    _run_cli()
