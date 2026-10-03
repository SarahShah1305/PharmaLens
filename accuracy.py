"""Compare PharmaLens /extract output with a Person 5 answer CSV.

Expected CSV columns: image,name,dose,frequency. Optional: language.
Run after the server starts, for example:
python accuracy.py answers.csv prescription_photos --api http://127.0.0.1:8000
"""

import argparse
import csv
import json
import mimetypes
import re
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any


FIELDS = ("name", "dose", "frequency")


def normalize(value: Any) -> str:
    text = "" if value is None else str(value)
    return " ".join(re.sub(r"[^\w]+", " ", text.casefold()).split())


def post_image(api_url: str, image_path: Path, language: str) -> dict[str, Any]:
    boundary = uuid.uuid4().hex
    mime_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    image_bytes = image_path.read_bytes()
    chunks = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n{language}\r\n".encode(),
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{image_path.name}\"\r\nContent-Type: {mime_type}\r\n\r\n"
        ).encode(),
        image_bytes,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/extract",
        data=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("answers", type=Path, help="Ground-truth CSV from Person 5")
    parser.add_argument("photos", type=Path, help="Directory containing the prescription photos")
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="PharmaLens server base URL")
    parser.add_argument("--out", type=Path, default=Path("results.json"), help="Output JSON path")
    args = parser.parse_args()

    with args.answers.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"image", *FIELDS}
        missing = required - set(reader.fieldnames or [])
        if missing:
            parser.error("Answer CSV is missing columns: " + ", ".join(sorted(missing)))
        rows = list(reader)
    if not rows:
        parser.error("Answer CSV has no data rows")

    field_correct = {field: 0 for field in FIELDS}
    field_total = {field: 0 for field in FIELDS}
    records = []
    response_cache: dict[tuple[str, str], dict[str, Any]] = {}
    started = time.time()
    for row in rows:
        image_path = args.photos / row["image"]
        record: dict[str, Any] = {"image": row["image"], "expected": {f: row[f] for f in FIELDS}}
        try:
            language = row.get("language") or "English"
            cache_key = (str(image_path.resolve()), language)
            if cache_key not in response_cache:
                response_cache[cache_key] = post_image(args.api, image_path, language)
            payload = response_cache[cache_key]
            medicines = payload.get("medicines") or []
            medicine_index = int(row.get("medicine_index") or 0)
            if medicine_index < 0 or medicine_index >= len(medicines):
                raise IndexError(f"medicine_index {medicine_index} outside response with {len(medicines)} medicines")
            actual = medicines[medicine_index]
            record["actual"] = {f: actual.get(f, "unclear") for f in FIELDS}
            record["field_correct"] = {}
            for field in FIELDS:
                expected_value = normalize(row[field])
                candidates = {normalize(actual.get(field, "unclear"))}
                if field == "name":
                    candidates.add(normalize(actual.get("generic_name", "")))
                equal = expected_value in candidates
                record["field_correct"][field] = equal
                field_correct[field] += int(equal)
                field_total[field] += 1
            record["all_fields_correct"] = all(record["field_correct"].values())
        except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, IndexError, ValueError) as exc:
            record["error"] = f"{type(exc).__name__}: {exc}"
            record["all_fields_correct"] = False
            for field in FIELDS:
                field_total[field] += 1
                record.setdefault("field_correct", {})[field] = False
        records.append(record)

    total = len(rows)
    result = {
        "metric": "normalized exact match",
        "samples": total,
        "overall_accuracy": sum(field_correct.values()) / sum(field_total.values()) if sum(field_total.values()) else 0,
        "field_accuracy": {
            field: {"correct": field_correct[field], "total": field_total[field],
                    "accuracy": field_correct[field] / field_total[field] if field_total[field] else 0}
            for field in FIELDS
        },
        "all_fields_correct": sum(bool(record.get("all_fields_correct")) for record in records),
        "elapsed_seconds": round(time.time() - started, 2),
        "records": records,
    }
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("samples", "overall_accuracy", "field_accuracy", "all_fields_correct")}, indent=2))
    print(f"Saved detailed results to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
