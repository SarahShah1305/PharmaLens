"""Cautious medicine helpers for the PharmaLens prescription reader."""

import csv
import re
from pathlib import Path
from typing import Any


DATA_PATH = Path(__file__).with_name("medicines.csv")
SAFETY_REMINDER = "Confirm with your pharmacist or doctor."
SAFETY_REMINDER_URDU = "اپنے فارماسسٹ یا ڈاکٹر سے تصدیق کریں۔"


def _medicine_rows() -> list[dict[str, str]]:
    with DATA_PATH.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def _clean(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def match_brand(medicine: dict[str, Any]) -> dict[str, Any]:
    """Add a generic name only for an exact known brand match."""
    item = dict(medicine)
    brand = _clean(item.get("name"))
    item["brand_name"] = brand
    item["generic_name"] = "unclear"
    if not brand or brand.casefold() == "unclear":
        return item

    key = re.sub(r"[^a-z0-9]+", " ", brand.casefold()).strip()
    for row in _medicine_rows():
        aliases = [part.strip() for part in row["brands"].split("|")]
        generic = row["generic_name"].casefold()
        matches = key == generic or any(
            key == re.sub(r"[^a-z0-9]+", " ", alias.casefold()).strip()
            or re.fullmatch(
                re.escape(re.sub(r"[^a-z0-9]+", " ", alias.casefold()).strip())
                + r"\s+\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml)",
                key,
            )
            for alias in aliases
        )
        if matches:
            item["generic_name"] = row["generic_name"]
            return item
    return item


def check_dose(medicine: dict[str, Any]) -> dict[str, Any]:
    """Flag missing/ambiguous doses and implausibly large transcription values.

    A clear result is not a medical approval. The limited reference rules are
    deliberately only warnings and cannot account for age, weight, formulation,
    health conditions, or other medicines.
    """
    item = dict(medicine)
    dose = _clean(item.get("dose"))
    warning = ""
    if not dose or dose.casefold() == "unclear":
        warning = "Dose is unclear; verify it with a pharmacist or doctor."
    elif re.search(r"\b(?:or|to|-)\b", dose, re.IGNORECASE) or "/" in dose:
        warning = "Dose contains multiple or ambiguous values; verify it with a pharmacist or doctor."
    else:
        match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(mg|g)\s*", dose, re.IGNORECASE)
        if not match:
            warning = "Dose format could not be checked automatically; verify it with a pharmacist or doctor."
        else:
            amount_mg = float(match.group(1)) * (1000 if match.group(2).casefold() == "g" else 1)
            # This coarse transcription anomaly check is not a recommended
            # dose limit; actual limits depend on the medicine and patient.
            if amount_mg >= 10000:
                warning = "This amount looks unusually large as a single dose; verify it with a pharmacist or doctor."

    item["dose_warning"] = warning
    item["dose_check"] = "warning" if warning else "not_flagged"
    item["dose_check_note"] = (
        "Automated checks are limited and cannot confirm that a dose is safe. "
        "Consider age, weight, formulation, health conditions, and other medicines."
    )
    return item


def explain(name: str, language: str) -> str:
    """Return a short, cautious explanation in English (en) or Urdu (ur)."""
    selected = "ur" if language == "ur" else "en"
    normalized = re.sub(r"[^a-z0-9]+", " ", _clean(name).casefold()).strip()
    description = ""
    if normalized and normalized != "unclear":
        for row in _medicine_rows():
            if normalized == row["generic_name"].casefold():
                description = row[f"purpose_{selected}"]
                break
    if not description:
        description = (
            "اس دوا کا مقصد یہاں واضح نہیں ہے؛ اپنے فارماسسٹ یا ڈاکٹر سے پوچھیں۔"
            if selected == "ur"
            else "The purpose of this medicine is not clear here; ask your pharmacist or doctor."
        )
    reminder = SAFETY_REMINDER_URDU if selected == "ur" else SAFETY_REMINDER
    return f"{description} {reminder}"


def explain_medicine(medicine: dict[str, Any], language: str) -> dict[str, Any]:
    """Attach the selected-language explanation while preserving the record."""
    item = dict(medicine)
    generic = _clean(item.get("generic_name"))
    name = generic if generic and generic.casefold() != "unclear" else _clean(item.get("name"))
    normalized_language = "ur" if language.casefold() in {"ur", "urdu"} else "en"
    item["explanation"] = explain(name, normalized_language)
    item["explanation_language"] = normalized_language
    return item
