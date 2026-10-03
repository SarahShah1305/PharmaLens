"""FastAPI entry point for the PharmaLens prescription reader."""

import base64
import json
import os
from typing import Any

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from extract import extract_medicines

load_dotenv()

app = FastAPI(title="PharmaLens", version="0.1.0")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
SUPPORTED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    language: str = Form(default="English"),
) -> JSONResponse:
    """Read a prescription image and return a structured, cautious transcription."""
    media_type = (file.content_type or "").lower()
    if language not in {"English", "Urdu"}:
        raise HTTPException(status_code=400, detail="Choose English or Urdu as the prescription language.")
    if media_type not in SUPPORTED_MEDIA_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, GIF, or WebP image.")

    image_bytes = await file.read(MAX_IMAGE_BYTES + 1)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="The image must be 10 MB or smaller.")

    api_key = os.getenv("ANTHROPIC_API_KEY")
    model = os.getenv("ANTHROPIC_MODEL")
    if not api_key or not model:
        raise HTTPException(
            status_code=503,
            detail="Server is not configured. Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL.",
        )

    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=90.0)
    try:
        response = await client.messages.create(
            model=model,
            max_tokens=2048,
            system=(
                f"The user selected {language} as the prescription language; use that as a "
                "hint, but inspect the handwriting and report the language actually detected. "
                "You transcribe prescription images. You are not a doctor and must not "
                "diagnose, recommend, or change medicines. Never infer unreadable text: use "
                "the exact string 'unclear' for any field you cannot confidently read. Do not "
                "calculate, normalize, or alter dose or frequency. Preserve them as written, "
                "then translate their meaning without adding medical advice. Return only "
                "valid JSON with this shape: "
                '{"prescription_language":"English or Urdu or unclear",'
                '"transcription_english":"string","transcription_urdu":"string",'
                '"medicines":[{"name":"English medicine name or unclear",'
                '"name_as_written":"name in original script or unclear",'
                '"dose":"dose as written or unclear","frequency":"frequency as written or unclear",'
                '"dose_english":"dose meaning in English or unclear",'
                '"dose_urdu":"dose meaning in Urdu or unclear",'
                '"frequency_english":"frequency meaning in English or unclear",'
                '"frequency_urdu":"frequency meaning in Urdu or unclear",'
                '"confidence":0.0}],"notes_english":"string","notes_urdu":"string"}. '
                "Return one medicine object per medicine line. Confidence must be a number "
                "from 0 to 1 and reflect transcription confidence, not medical correctness. "
                "Translate Urdu writing into English and English writing into Urdu so both "
                "transcription fields are populated when readable. Keep all medication "
                "instructions faithful to the page."
            ),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64.b64encode(image_bytes).decode("ascii"),
                            },
                        },
                        {"type": "text", "text": "Read this prescription carefully."},
                    ],
                }
            ],
        )
    except anthropic.APIConnectionError as exc:
        raise HTTPException(status_code=502, detail="Could not connect to the reading service.") from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail="The reading service returned an error.") from exc
    finally:
        await client.close()

    text_blocks = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    if not text_blocks:
        raise HTTPException(status_code=502, detail="The reading service returned no text.")
    raw_text = "\n".join(text_blocks).strip()
    if raw_text.startswith("```"):
        raw_text = raw_text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        result: Any = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The reading service returned invalid JSON.") from exc

    if not isinstance(result, dict) or not isinstance(result.get("medicines"), list):
        raise HTTPException(status_code=502, detail="The reading service returned an unexpected result format.")

    try:
        result = extract_medicines(result)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=502, detail="Could not process the extracted medicines.") from exc

    result["safety_note"] = "Confirm all prescription details with your pharmacist or doctor."
    return JSONResponse(content=result)
