#!/usr/bin/env python3
"""
Mewgenics Save File Extractor
Extracts cat data from steamcampaign01.sav (SQLite database with LZ4-compressed blobs).

Room-first approach: only extracts cats that have a room assignment, then fetches
parent/grandparent data as needed for lineage info.

Outputs: mewgenics_cats.json with name, icon, sex, stats, libido, aggression, room, parents, grandparents.

Usage:
    python get-the-data/mewgenics_extract.py                          # looks for steamcampaign01.sav in current dir
    python get-the-data/mewgenics_extract.py /path/to/steamcampaign01.sav
"""


import sqlite3
import struct
import json
import sys
import os

from typing import Optional, Tuple


# Native Windows process check (no external packages)
import subprocess
def is_process_running(process_name: str) -> bool:
	try:
		# Only works on Windows
		output = subprocess.check_output(['tasklist'], creationflags=0x08000000).decode(errors='ignore')
		return process_name.lower() in output.lower()
	except Exception:
		return False

# =============================================================================
# .env Loader (Standard Library Only)
# =============================================================================
def load_dotenv(dotenv_path):
    if not os.path.exists(dotenv_path):
        return
    with open(dotenv_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, val = line.split('=', 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)



# =============================================================================
# LZ4 Block Decompression
# =============================================================================

def lz4_decompress_block(src: bytes, uncompressed_size: int) -> bytes:
    """Decompress an LZ4 block. Each cat blob starts with a uint32 uncompressed
    size, followed by the LZ4-compressed payload."""
    dst = bytearray()
    pos = 0
    while pos < len(src) and len(dst) < uncompressed_size:
        token = src[pos]; pos += 1
        lit_len = (token >> 4) & 0xF
        match_len = token & 0xF

        if lit_len == 15:
            while pos < len(src):
                extra = src[pos]; pos += 1
                lit_len += extra
                if extra != 255:
                    break

        if pos + lit_len > len(src):
            dst.extend(src[pos:])
            break
        dst.extend(src[pos:pos + lit_len])
        pos += lit_len

        if len(dst) >= uncompressed_size:
            break
        if pos + 2 > len(src):
            break

        offset = src[pos] | (src[pos + 1] << 8); pos += 2
        if offset == 0:
            break

        match_len += 4
        if (token & 0xF) == 15:
            while pos < len(src):
                extra = src[pos]; pos += 1
                match_len += extra
                if extra != 255:
                    break

        match_pos = len(dst) - offset
        if match_pos < 0:
            break
        for i in range(match_len):
            if match_pos + (i % offset) < len(dst):
                dst.append(dst[match_pos + (i % offset)])

    return bytes(dst[:uncompressed_size])


# =============================================================================
# Cat Blob Parser
# =============================================================================

def u64_le(b: bytes, off: int) -> int:
    return struct.unpack_from('<Q', b, off)[0]

def i64_le(b: bytes, off: int) -> int:
    return struct.unpack_from('<q', b, off)[0]

def find_birthday_info(dec: bytes, current_day: Optional[int] = None) -> Tuple[str, Optional[int], Optional[int]]:
    """
    Find (class_name, birthday_day, birthday_off) in a decompressed cat blob.

    - Near the end of the blob there is a length-prefixed ASCII identifier that is the class name:
          <u64 len> <ASCII bytes...>
    - 12 bytes AFTER the end of that string is:
          <i64 birthday_day>
    - Immediately after birthday_day is a sentinel:
          <i64 -1>   (0xFF..FF)

    Age shown in UI is:
        age_days = current_day - birthday_day
    """
    n = len(dec)
    if n < 64:
        return ("", None, None)

    AGE_CAP = 500_000

    def _accept(bday: int) -> bool:
        if current_day is None:
            return True
        age = int(current_day) - int(bday)
        return 0 <= age <= AGE_CAP

    def _looks_ascii_ident(sb: bytes) -> bool:
        return all(32 <= b < 127 for b in sb)

    def _scan_range(start: int, end: int) -> Optional[Tuple[str, int, int]]:
        best: Optional[Tuple[str, int, int]] = None
        for off in range(start, max(start, end - 8)):
            if off + 8 > n:
                break
            ln = u64_le(dec, off)
            if ln < 3 or ln > 64:
                continue
            str_off = off + 8
            str_end = str_off + int(ln)
            bday_off = str_end + 12
            if bday_off + 16 > n:
                continue
            sb = dec[str_off:str_end]
            if not _looks_ascii_ident(sb):
                continue
            bday = i64_le(dec, bday_off)
            sentinel = i64_le(dec, bday_off + 8)
            if sentinel != -1:
                continue
            if not _accept(int(bday)):
                continue
            cls = sb.decode("ascii", errors="strict")
            cand = (cls, int(bday), int(bday_off))
            if best is None or cand[2] > best[2]:
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

def parse_cat_blob(key: int, blob: bytes, save_day: Optional[int] = None) -> dict | None:
    """Parse a single cat record from its LZ4-compressed blob.

    Blob layout (after decompression):
        [0..3]   unknown int32
        [4..7]   unknown int32
        [8..11]  unknown int32
        [12..15] name_length (utf-16 chars)
        [16..19] padding (0)
        [20..]   name (utf-16-le, name_length * 2 bytes)

    After name:
        [+0..+3] icon_length (int32)
        [+4..+7] padding (0)
        [+8..]   icon string (ascii, e.g. "triangle", "circle", "star2", "str", "con")
        [+8+icon_length] sex byte: 0=male, 1=female, 2=herm

    Then variable-length fields until the sprite string ("male..." or "female..." + digits).

    Relative to sprite string offset (g):
        [g-8]   sprite string length (int32)
        [g-4]   padding (0)
        [g..]   sprite string (ascii: "male" or "female" + digits, length from header)

    After sprite string:
        [+0..+7]  unknown float64
        [+8..+34] 7× int32 stats: STR, DEX, CON, INT, SPD, CHA, LCK

    Libido & aggression are float64 (0.0-1.0) in the slot region after "None":
        slot 0 (None+8):  libido
        slot 4 (None+40): aggression
        Thresholds: <0.333=low, 0.333-0.667=average, >0.667=high
    """
    # Decompress
    if len(blob) < 8:
        return None
    claimed = struct.unpack_from('<I', blob, 0)[0]
    try:
        dec = lz4_decompress_block(blob[4:], claimed)
    except Exception:
        return None
    if len(dec) < 200:
        return None

    # Name
    name_len = struct.unpack_from('<I', dec, 12)[0]
    if name_len > 30 or struct.unpack_from('<I', dec, 16)[0] != 0:
        return None
    try:
        name = dec[20:20 + name_len * 2].decode('utf-16-le')
    except Exception:
        return None
    name_end = 20 + name_len * 2

    # Find gender/sprite string (e.g. "male15", "female52")
    # The string is preceded by a header: int32(str_len) + int32(0).
    # IMPORTANT: Use the header-declared length, NOT greedy digit scanning,
    # because some sprite IDs have digits that bleed into the next field
    # (e.g. header says 6 for "male15" but greedy scan would read "male159").
    gender_off = -1
    gender_str = ""
    for i in range(name_end, min(len(dec) - 6, name_end + 500)):
        if dec[i:i + 6] == b'female' or \
           (dec[i:i + 4] == b'male' and (i < 2 or dec[i - 2:i] != b'fe')):
            # Read the actual string length from the header at i-8
            if i >= 8:
                header_len = struct.unpack_from('<I', dec, i - 8)[0]
                header_pad = struct.unpack_from('<I', dec, i - 4)[0]
                if 4 <= header_len <= 20 and header_pad == 0:
                    gender_str = dec[i:i + header_len].decode('ascii', errors='replace')
                    gender_off = i
                    break
            # Fallback: greedy scan if header is invalid
            prefix_len = 6 if dec[i:i + 6] == b'female' else 4
            end = i + prefix_len
            while end < len(dec) and chr(dec[end]).isdigit():
                end += 1
            gender_str = dec[i:end].decode('ascii')
            gender_off = i
            break

    if not gender_str or gender_off < 16:
        return None

    # Stats (7× int32 starting 8 bytes after gender string)
    gs_end = gender_off + len(gender_str)
    if gs_end + 36 > len(dec):
        return None
    stats = [struct.unpack_from('<i', dec, gs_end + 8 + j * 4)[0] for j in range(7)]
    if any(s < -10 or s > 30 for s in stats):
        return None

    # Libido & aggression are stored as float64 values (0.0-1.0) in the slot
    # region after the "None" marker. Slot layout (8 bytes each):
    #   slot 0: libido (float64, 0-1)
    #   slot 1: unknown float64
    #   slot 2: loves_key (int32 + 4 pad)
    #   slot 3: unknown float64
    #   slot 4: aggression (float64, 0-1)
    #   slot 5: hates_key (int32 + 4 pad)
    # Thresholds: 0-0.333 = low, 0.333-0.667 = average, 0.667-1.0 = high
    libido_raw = 0.5
    aggression_raw = 0.5
    none_off = dec.find(b'None', name_end)
    if none_off < 0:
        none_off = dec.find(b'none', name_end)
    if none_off >= 0:
        slot_base = none_off + 8
        if slot_base + 40 <= len(dec):
            libido_raw = struct.unpack_from('<d', dec, slot_base)[0]
            aggression_raw = struct.unpack_from('<d', dec, slot_base + 32)[0]

    # Actual sex is stored as a byte right after the tag string that follows the name.
    # Layout after name: [int32 tag_len] [int32 pad=0] [tag_bytes] [sex_byte]
    # sex_byte: 0=male, 1=female, 2=herm
    tag_len = struct.unpack_from('<I', dec, name_end)[0]
    icon = dec[name_end + 8 : name_end + 8 + tag_len].decode('ascii', errors='replace') if tag_len < 100 else ""
    sex_byte_off = name_end + 8 + tag_len
    sex_byte = dec[sex_byte_off] if sex_byte_off < len(dec) else 0
    sex = {0: "male", 1: "female", 2: "herm"}.get(sex_byte, f"unknown({sex_byte})")

    # Parse loves/hates from float64 slot region
    # After the name, find the first "None" marker. Then skip 8 bytes (None + int32).
    # The following 8-byte slots contain: slot 2 = loves key, slot 5 = hates key.
    loves_key = -1
    hates_key = -1
    none_off = dec.find(b'None', name_end)
    if none_off < 0:
        none_off = dec.find(b'none', name_end)
    if none_off >= 0:
        slot_base = none_off + 8  # After None(4) + int32(4)
        loves_off = slot_base + 2 * 8
        hates_off = slot_base + 5 * 8
        if loves_off + 4 <= len(dec):
            v = struct.unpack_from('<I', dec, loves_off)[0]
            loves_key = -1 if v == 0xFFFFFFFF else v
        if hates_off + 4 <= len(dec):
            v = struct.unpack_from('<I', dec, hates_off)[0]
            hates_key = -1 if v == 0xFFFFFFFF else v

    def classify_trait(val):
        if val < 0.333:
            return "low"
        elif val < 0.667:
            return "average"
        return "high"

    # Birthday extraction

    _, birthday_day, _ = find_birthday_info(dec, save_day)
    # Birthday should match game's value exactly, including for kittens (can be > saveDay)
    # For kittens, birthday = saveDay - age + 2 (age=1, so birthday = saveDay + 1)
    # The value from find_birthday_info is correct as-is, so just use it directly as integer

    return {
        "key": key,
        "name": name,
        "icon": icon,
        "sex": sex,
        "STR": stats[0],
        "DEX": stats[1],
        "CON": stats[2],
        "INT": stats[3],
        "SPD": stats[4],
        "CHA": stats[5],
        "LCK": stats[6],
        "libido": classify_trait(libido_raw),
        "libido_raw": round(libido_raw, 4),
        "aggression": classify_trait(aggression_raw),
        "aggression_raw": round(aggression_raw, 4),
        "loves_key": loves_key,
        "hates_key": hates_key,
        "birthday": birthday_day,
    }


# =============================================================================
# Room Assignment Parser (house_state)
# =============================================================================

def parse_room_assignments(house_state: bytes) -> dict[int, str]:
    """Parse the house_state blob to get cat_key -> room_name mapping.

    Correct layout (key comes FIRST, then room string, then coordinates):
        Header (8 bytes):
            [0..3]  int32 = 0
            [4..7]  int32 = entry count

        Per entry (starting at byte 8):
            int32(cat_key) + int32(0)                — 8 bytes: which cat
            int32(str_len) + int32(0) + room(ascii)  — 8+N bytes: room name
            float64(x) + float64(y) + float64(z)     — 24 bytes: position

        Total per entry: 16 + str_len + 24 bytes

    The last entry may be truncated (missing room string or coordinates).
    If we can still read the cat_key, we include it with room="?" so the
    caller can attempt to resolve it.
    """
    count = struct.unpack_from('<I', house_state, 4)[0]
    room_map = {}
    pos = 8  # entries start immediately after the 8-byte header

    for _ in range(count):
        # Need at least 16 bytes for cat_key + room string header
        if pos + 16 > len(house_state):
            break

        cat_key = struct.unpack_from('<I', house_state, pos)[0]
        # pad at pos+4 is always 0
        slen = struct.unpack_from('<I', house_state, pos + 8)[0]
        # pad at pos+12 is always 0

        # Skip entries with invalid/empty room strings (truncated tail entries)
        if slen < 1 or slen > 30:
            break

        # Need room string + 24 bytes of xyz coordinates
        if pos + 16 + slen + 24 > len(house_state):
            break

        room_name = house_state[pos + 16:pos + 16 + slen].decode('ascii')
        room_map[cat_key] = room_name
        pos = pos + 16 + slen + 24

    return room_map


# =============================================================================
# Pedigree Parser (parent/grandparent extraction)
# =============================================================================

def parse_pedigree(pedigree: bytes, max_cat_key: int) -> dict[int, tuple[int, int]]:
    """Parse the pedigree blob to extract parent pairs.

    The pedigree contains int64 values starting at offset 552. Parent relationships
    are stored as consecutive triplets: (child_key, parent2_key, parent1_key).

    Key insight: a child's database key is always HIGHER than both parents' keys,
    because children are created after parents. Filtering for child > both parents
    gives unique parent pairs for ~96% of bred cats.

    Returns: dict of child_key -> (parent1_key, parent2_key)
             where -1 means "stray / no parent on this side"
    """
    data_start = 552
    if len(pedigree) < data_start + 24:
        return {}

    # Read all int64 values
    all_vals = []
    for off in range(data_start, len(pedigree) - 8, 8):
        v = struct.unpack_from('<q', pedigree, off)[0]
        all_vals.append((off, v))

    def is_cat_or_sentinel(v):
        return (1 <= v <= max_cat_key) or v == -1

    def score_parent_pair(parent1_key: int, parent2_key: int) -> int:
        if parent1_key == -1 and parent2_key == -1:
            return 0
        if parent1_key > 0 and parent2_key > 0 and parent1_key != parent2_key:
            return 4
        if parent1_key > 0 and parent2_key > 0 and parent1_key == parent2_key:
            return -1
        return 2

    parent_map = {}
    parent_score_map = {}

    for i in range(len(all_vals) - 2):
        o1, v1 = all_vals[i]
        o2, v2 = all_vals[i + 1]
        o3, v3 = all_vals[i + 2]

        # Must be consecutive int64 positions
        if o2 - o1 != 8 or o3 - o2 != 8:
            continue
        # First value is child (valid cat key)
        if not (1 <= v1 <= max_cat_key):
            continue
        # Second and third are parents (cat keys or -1 sentinel)
        if not is_cat_or_sentinel(v2):
            continue
        if not is_cat_or_sentinel(v3):
            continue
        # Child key must be greater than both parent keys
        if v2 != -1 and v1 <= v2:
            continue
        if v3 != -1 and v1 <= v3:
            continue

        # Triplet order in file is (child, parent2, parent1) — swap to (parent1, parent2)
        parent1_key = v3  # second in file = parent1 in game
        parent2_key = v2  # first in file = parent2 in game

        pair = (parent1_key, parent2_key)
        pair_score = score_parent_pair(parent1_key, parent2_key)

        if v1 not in parent_map:
            parent_map[v1] = pair
            parent_score_map[v1] = pair_score
        else:
            existing_score = parent_score_map.get(v1, float('-inf'))
            if pair_score > existing_score:
                parent_map[v1] = pair
                parent_score_map[v1] = pair_score

    return parent_map


# =============================================================================
# Main Extraction
# =============================================================================

def fetch_cat_blobs(cur, keys: set[int], save_day: Optional[int] = None) -> dict[int, dict]:
    """Fetch and parse cat blobs for a specific set of keys."""
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    cur.execute(f"SELECT key, data FROM cats WHERE key IN ({placeholders}) ORDER BY key",
                list(keys))
    cats = {}
    for key, blob in cur.fetchall():
        cat = parse_cat_blob(key, blob, save_day)
        if cat:
            cats[key] = cat
    return cats


def extract(save_path: str) -> list[dict]:
    """Extract cat data from a Mewgenics save file.

    Room-first approach:
        1. Parse room assignments to find housed cat keys
        2. Fetch cat blobs only for housed cats
        3. Parse pedigree to find parents & grandparents
        4. Fetch additional cat blobs for ancestor names

    Args:
        save_path: Path to steamcampaign01.sav

    Returns:
        List of cat dicts for housed cats with all extracted fields
    """
    conn = sqlite3.connect(save_path)
    cur = conn.cursor()

    # --- 1. Parse room assignments first ---
    cur.execute("SELECT data FROM files WHERE key='house_state'")
    row = cur.fetchone()
    room_map = parse_room_assignments(row[0]) if row else {}

    housed_keys = set(room_map.keys())
    if not housed_keys:
        conn.close()
        return [], 0, 0


    # --- 2. Fetch cat blobs only for housed cats ---
    # We need save_day for birthday extraction, so parse pedigree first
    cur.execute("SELECT key FROM cats ORDER BY key DESC LIMIT 1")
    max_key = cur.fetchone()[0]

    cur.execute("SELECT data FROM files WHERE key='pedigree'")
    row = cur.fetchone()
    pedigree_blob = row[0] if row else None
    parent_map = parse_pedigree(pedigree_blob, max_key) if pedigree_blob else {}

    # saveDay: current in-game day, stored as int32 at offset 4584 in the pedigree blob
    save_day = struct.unpack_from('<i', pedigree_blob, 4584)[0] if pedigree_blob and len(pedigree_blob) >= 4588 else 0

    housed_cats = fetch_cat_blobs(cur, housed_keys, save_day)
    # Remove keys that failed to parse
    housed_keys = set(housed_cats.keys())


    # --- 3. Parse pedigree to find parent/grandparent keys ---
    # (already done above)

    # Collect ancestor keys we need names for
    ancestor_keys = set()
    for key in housed_keys:
        c = housed_cats[key]
        p1_key, p2_key = parent_map.get(key, (-1, -1))
        for pk in [p1_key, p2_key]:
            if pk and pk > 0:
                ancestor_keys.add(pk)
                # Grandparents
                gp1, gp2 = parent_map.get(pk, (-1, -1))
                for gpk in [gp1, gp2]:
                    if gpk and gpk > 0:
                        ancestor_keys.add(gpk)
        # Loves/hates keys
        if c["loves_key"] > 0:
            ancestor_keys.add(c["loves_key"])
        if c["hates_key"] > 0:
            ancestor_keys.add(c["hates_key"])

    # Only fetch ancestors we don't already have
    missing_keys = ancestor_keys - housed_keys

    # --- 4. Fetch ancestor blobs for name lookups ---
    ancestor_cats = fetch_cat_blobs(cur, missing_keys, save_day)

    conn.close()

    # --- Build name lookup from housed + ancestor cats ---
    all_parsed = {**housed_cats, **ancestor_cats}
    name_lookup = {k: v["name"] for k, v in all_parsed.items()}

    def get_name(key):
        if key is None or key <= 0:
            return ""
        return name_lookup.get(key, f"?key{key}")

    # --- Assemble output (housed cats only) ---
    output = []
    for key in sorted(housed_keys):
        c = housed_cats[key]
        p1_key, p2_key = parent_map.get(key, (-1, -1))
        if p1_key > 0 and p1_key == p2_key:
            p2_key = -1

        # Grandparents: look up each parent's parents
        gp_keys = []
        for pk in [p1_key, p2_key]:
            if pk and pk > 0 and pk in parent_map:
                gp1, gp2 = parent_map[pk]
                gp_keys.extend([gp1, gp2])
            else:
                gp_keys.extend([-1, -1])

        is_stray = (p1_key <= 0 and p2_key <= 0)

        entry = {
            "name": c["name"],
            "id": c["name"].lower().replace(" ", "_"),
            "icon": c.get("icon", ""),
            "sex": c["sex"],
            "STR": c["STR"],
            "DEX": c["DEX"],
            "CON": c["CON"],
            "INT": c["INT"],
            "SPD": c["SPD"],
            "CHA": c["CHA"],
            "LCK": c["LCK"],
            "libido": c["libido"],
            "libido_raw": c["libido_raw"],
            "aggression": c["aggression"],
            "aggression_raw": c["aggression_raw"],
            "loves": get_name(c["loves_key"]),
            "hates": get_name(c["hates_key"]),
            "room": room_map.get(key, ""),
            "stray": is_stray,
            "parent1": get_name(p1_key),
            "parent2": get_name(p2_key),
            "grandparent1": get_name(gp_keys[0]),
            "grandparent2": get_name(gp_keys[1]),
            "grandparent3": get_name(gp_keys[2]),
            "grandparent4": get_name(gp_keys[3]),
            "saveDay": save_day,
            "birthday": c.get("birthday"),
        }
        output.append(entry)

    # Return output, number of housed cats, number of ancestor blobs fetched
    return output, len(housed_cats), len(ancestor_cats)


# =============================================================================
# CLI
# =============================================================================

def main():
    import datetime
    # Safety: check if Mewgenics.exe is running (Windows only)
    if is_process_running("Mewgenics.exe"):
        print("Mewgenics is running. Please close the game first.")
        sys.exit(1)

    # Load .env file from script directory (if present)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dotenv_path = os.path.join(script_dir, '.env')
    load_dotenv(dotenv_path)

    # Capture script start time without milliseconds
    script_start_time = datetime.datetime.now().replace(microsecond=0).isoformat()


    # --- Debug mode CLI argument parsing ---
    import shlex
    debug_mode = False
    debug_catname = None
    args = []
    argv = shlex.split(' '.join(sys.argv[1:]))
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--debug":
            debug_mode = True
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                debug_catname = argv[i + 1]
                i += 1
        elif not a.startswith("--"):
            args.append(a)
        i += 1
    if debug_mode and not debug_catname:
        debug_catname = "yaddiel"

    if args:
        save_path = args[0]
        source = "user argument"
    else:
        # Try env variable (case-insensitive)
        # Support both mewgenics_save_location and MEWGENICS_SAVE_LOCATION
        env_path = os.environ.get('mewgenics_save_location') or os.environ.get('MEWGENICS_SAVE_LOCATION')
        if env_path:
            expanded = os.path.expandvars(env_path)
            if os.path.isdir(expanded):
                save_path = os.path.join(expanded, 'steamcampaign01.sav')
                source = ".env directory"
            else:
                save_path = expanded
                source = ".env file"
        else:
            save_path = "steamcampaign01.sav"
            source = "current directory"

    def winpath(p):
        # Normalize to Windows path and wrap in quotes (no space escaping)
        path = os.path.normpath(p)
        return '"' + path + '"'

    print("\n==============================")
    print("Reading save from:")
    print(f"[{source}]")
    print("\nPath:")
    print(f"[{winpath(save_path)}]")
    print("==============================\n")

    if not os.path.exists(save_path):
        print("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"[ ERROR: Save file not found ]\n[ Path: {save_path} ]")
        print(f"[ Usage: python {sys.argv[0]} [path/to/steamcampaign01.sav] ]")
        print("[ Or set mewgenics_save_location in a .env file. ]")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n")
        sys.exit(1)


    cats, housed_count, ancestor_count = extract(save_path)

    # Add script_start_time to each cat
    for cat in cats:
        cat["script_start_time"] = script_start_time

    # --- Debug mode output ---
    if debug_mode:
        found = False
        for cat in cats:
            if cat["name"].lower() == debug_catname.lower():
                print(f"\n[DEBUG] Cat '{cat['name']}' found:")
                print(json.dumps(cat, indent=2, ensure_ascii=False))
                found = True
        if not found:
            print(f"[DEBUG] Cat '{debug_catname}' not found in extracted data.")
        sys.exit(0)

    # Output to public subfolder by default
    public_dir = os.path.join(script_dir, "public")
    os.makedirs(public_dir, exist_ok=True)
    out_path = os.path.join(public_dir, "mewgenics_cats.json")
    old_cats = []
    if os.path.exists(out_path):
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                old_cats = json.load(f)
        except Exception:
            print("Warning: Failed to load existing .json for diff.")

    def cat_map(cat_list):
        return {cat["id"]: cat for cat in cat_list}

    old_map = cat_map(old_cats)
    new_map = cat_map(cats)

    added = [cat for cid, cat in new_map.items() if cid not in old_map]
    removed = [cat for cid, cat in old_map.items() if cid not in new_map]
    modified = []
    for cid in old_map:
        if cid in new_map:
            # Compare relevant fields
            old = old_map[cid]
            new = new_map[cid]
            # Ignore fields that are not relevant for diff
            fields = ["name", "icon", "sex", "STR", "DEX", "CON", "INT", "SPD", "CHA", "LCK", "libido", "aggression", "room", "parent1", "parent2", "grandparent1", "grandparent2", "grandparent3", "grandparent4", "loves", "hates", "stray"]
            if any(old.get(f) != new.get(f) for f in fields):
                modified.append(new)

    if old_cats:
        if added or removed or modified:
            print("\n==============================")
            print("Existing .json found, however our data is newer.")
            print(f"[{len(removed)} cat(s) removed, {len(added)} cat(s) added, {len(modified)} cat(s) modified]")
            print("Do you want to overwrite? (y/n): ", end="")
            resp = input().strip().lower()
            print("=========================\n")
            if resp != "y":
                print("Aborting procedure. No changes written.")
                sys.exit(0)
        else:
            print("\n==============================")
            print("Existing .json found. No changes in newer output compared to old file detected.")
            print("Aborting procedure, make sure you have the right save file.")
            print("Sometimes you need to press 'end of day' for it to save things to the save file.")
            sys.exit(0)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(cats, f, indent=2, ensure_ascii=False)

    print("Total cats found: [{}]".format(len(cats)))
    print("Found [{}] cats with room assignments".format(housed_count))
    print("Fetched [{}] additional ancestor blobs for name lookups".format(ancestor_count))
    print("\n==============================")
    print("Updated .json file at :")
    print(f"[{winpath(out_path)}]")
    print("==============================\n")


if __name__ == "__main__":
	main()
