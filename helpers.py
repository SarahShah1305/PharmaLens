"""Integration points for Person 2's brand, dose, and Urdu helpers.

Keep these function names and their medicine-dictionary input/output contract stable.
Person 2 can replace each placeholder body without changing the server endpoint.
"""

from typing import Any


def match_brand(medicine: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: map a readable brand name to its generic name."""
    return medicine


def check_dose(medicine: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: add a dose check or warning without changing the prescription."""
    return medicine


def explain_urdu(medicine: dict[str, Any]) -> dict[str, Any]:
    """Placeholder: add a simple Urdu explanation."""
    return medicine
