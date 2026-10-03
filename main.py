"""FastAPI entry point for the PharmaLens prescription reader."""

import asyncio
import json
import logging
import os
from typing import Any

from google import genai
from google.genai import types
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
import httpx

from extract import extract_medicines

load_dotenv()

app = FastAPI(title="PharmaLens", version="0.1.0")
logger = logging.getLogger("uvicorn.error")
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

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Server is not configured. Set GEMINI_API_KEY in the server's .env file.",
        )

    client = genai.Client(api_key=api_key)
    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=model,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=media_type),
                    "Read this prescription carefully.",
                ],
                config=types.GenerateContentConfig(
                    max_output_tokens=2048,
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_level="minimal"),
                    system_instruction=(
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
                ),
            ),
            timeout=60,
        )
    except asyncio.TimeoutError as exc:
        logger.warning("Gemini request exceeded the 60-second timeout.")
        raise HTTPException(
            status_code=504,
            detail="Reading took longer than 60 seconds. Try again with a clearer, smaller photo.",
        ) from exc
    except genai.errors.APIError as exc:
        status_code = getattr(exc, "code", None)
        error_message = getattr(exc, "message", None) or str(exc)
        logger.error("Gemini API error (HTTP %s): %s", status_code or "unknown", error_message)
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API error (HTTP {status_code or 'unknown'}). Check the server terminal for details.",
        ) from exc
    except httpx.RequestError as exc:
        logger.error("Could not connect to Gemini: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="The server could not connect to Gemini. Check the computer's internet/proxy connection, then try again.",
        ) from exc
    finally:
        await client.aio.aclose()

    raw_text = (response.text or "").strip()
    if not raw_text:
        raise HTTPException(status_code=502, detail="The reading service returned no text.")
    if raw_text.startswith("```"):
        raw_text = raw_text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        result: Any = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The reading service returned invalid JSON.") from exc

    if not isinstance(result, dict) or not isinstance(result.get("medicines"), list):
        raise HTTPException(status_code=502, detail="The reading service returned an unexpected result format.")

    try:
        result = extract_medicines(result, language=language)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=502, detail="Could not process the extracted medicines.") from exc

    result["safety_note"] = "Confirm all prescription details with your pharmacist or doctor."
    return JSONResponse(content=result)
