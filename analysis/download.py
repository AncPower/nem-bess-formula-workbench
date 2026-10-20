"""Download only public NSW1 TRADINGPRICE; no private service or dependency."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

BASE = "https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM"


def archive_url(year, month):
    stamp = f"{year}{month:02d}010000"
    name = f"PUBLIC_DVD_TRADINGPRICE_{stamp}.zip" if (year, month) <= (2024, 7) else f"PUBLIC_ARCHIVE%23TRADINGPRICE%23FILE01%23{stamp}.zip"
    return f"{BASE}/{year}/MMSDM_{year}_{month:02d}/MMSDM_Historical_Data_SQLLoader/DATA/{name}"


def parse_rows(rows, prices, start, end):
    header = None
    for row in rows:
        if not row or row[0] not in ("I", "D"):
            continue
        if len(row) < 4 or row[1:3] != ["TRADING", "PRICE"]:
            continue
        if row[0] == "I":
            header = row
            if not {"SETTLEMENTDATE", "REGIONID", "RRP", "INVALIDFLAG", "PRICE_STATUS"} <= set(header):
                raise ValueError("TRADING.PRICE missing required columns")
            continue
        if header is None or len(row) != len(header):
            raise ValueError("Invalid TRADING.PRICE row/header")
        fields = dict(zip(header, row))
        if fields["REGIONID"].strip() != "NSW1" or fields["INVALIDFLAG"].strip() != "0" or fields["PRICE_STATUS"].strip().upper() != "FIRM":
            continue
        timestamp = datetime.strptime(fields["SETTLEMENTDATE"].strip(), "%Y/%m/%d %H:%M:%S")
        if timestamp.second or timestamp.minute % 5:
            raise ValueError(f"Unaligned interval: {timestamp}")
        trading_date = (timestamp - timedelta(minutes=5)).date()
        if not start <= trading_date <= end:
            continue
        value = float(fields["RRP"])
        if not math.isfinite(value):
            raise ValueError("Non-finite RRP")
        key = timestamp.isoformat(timespec="minutes")
        if key in prices and prices[key] != value:
            raise ValueError(f"Conflicting duplicate price: {key}")
        prices[key] = value
    if header is None:
        raise ValueError("Missing TRADING.PRICE header")


def download(start, end, cache):
    if start > end:
        raise ValueError("Start must not exceed end")
    cache.mkdir(parents=True, exist_ok=True)
    prices, sources = {}, []
    current = start.replace(day=1)
    last = (end + timedelta(days=1)).replace(day=1)
    while current <= last:
        url = archive_url(current.year, current.month)
        path = cache / f"{current:%Y-%m}.zip"
        metadata_path = path.with_suffix(".manifest.json")
        metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
        digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
        if not digest or metadata.get("url") != url or metadata.get("sha256") != digest:
            print(f"Downloading {url}", flush=True)
            with urlopen(url, timeout=60) as response, tempfile.TemporaryFile() as temporary:
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 128 * 1024 * 1024:
                        raise ValueError("Archive exceeds 128 MiB limit")
                    temporary.write(chunk)
                temporary.seek(0)
                content = temporary.read()
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if archive.testzip() is not None:
                    raise ValueError("Corrupt ZIP")
            digest = hashlib.sha256(content).hexdigest()
            metadata = {"url": url, "sha256": digest, "downloaded_at": datetime.now(timezone.utc).isoformat()}
            staging = path.with_suffix(".partial")
            staging.write_bytes(content)
            staging.replace(path)
            metadata_path.write_text(json.dumps(metadata))
        with zipfile.ZipFile(path) as archive:
            entries = [entry for entry in archive.infolist() if entry.filename.upper().endswith(".CSV")]
            if len(entries) != 1 or entries[0].file_size > 1024 * 1024 * 1024:
                raise ValueError("Expected one CSV of at most 1 GiB")
            with archive.open(entries[0]) as member:
                parse_rows(csv.reader(io.TextIOWrapper(member, encoding="utf-8-sig")), prices, start, end)
        sources.append(metadata)
        current = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
    return {"region_id": "NSW1", "start_date": start.isoformat(), "end_date": end.isoformat(),
            "sources": sources, "prices": sorted(prices.items())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    parser.add_argument("--cache", type=Path, default=Path(".cache/aemo"))
    parser.add_argument("--output", type=Path, default=Path(".cache/history.json"))
    args = parser.parse_args()
    result = download(args.start, args.end, args.cache)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    staging = args.output.with_suffix(".partial")
    staging.write_text(json.dumps(result, allow_nan=False) + "\n")
    staging.replace(args.output)
