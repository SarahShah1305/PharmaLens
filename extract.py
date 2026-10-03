"""Apply the agreed helper functions to Claude's medicine list."""

from typing import Any

from helpers import check_dose, explain_medicine, match_brand


def extract_medicines(result: dict[str, Any], language: str = "English") -> dict[str, Any]:
    """Enrich each medicine while preserving the shared API response shape."""
    medicines = result.get("medicines")
    if not isinstance(medicines, list):
        raise ValueError("result.medicines must be a list")

    processed = []
    for medicine in medicines:
        if not isinstance(medicine, dict):
            raise ValueError("each medicine must be an object")
        item = medicine
        for helper in (match_brand, check_dose):
            item = helper(item)
            if not isinstance(item, dict):
                raise TypeError(f"{helper.__name__} must return a medicine object")
        item = explain_medicine(item, "ur" if language.casefold() == "urdu" else "en")
        processed.append(item)

    result["medicines"] = processed
    return result
