# PharmaLens

PharmaLens is an Expo mobile app with a Python API. A user chooses English or Urdu, then uploads or takes a prescription photo. The server sends it to Claude for a cautious transcription and bilingual reading. It is a reading aid, not a doctor: it does not diagnose or change medicines. Users should confirm details with a pharmacist or doctor. Unreadable writing should be returned as `unclear`, never guessed.

The Expo app is in `mobile/`; Sara's FastAPI server is in the repository root. Diya's three helper functions remain placeholders in `helpers.py` for her to implement.

## Sara's server starter

The FastAPI server accepts an image and `language` (`English` or `Urdu`) at `POST /extract`, sends it to Claude, then passes each medicine through the helper functions in `helpers.py`. Those functions are placeholders for Diya to implement. Their names and dictionary input/output contract are the agreed integration points.

The response includes English and Urdu prescription transcriptions, plus a `medicines` array. Each medicine keeps the agreed `name`, `dose`, `frequency`, and `confidence` fields and includes bilingual dose and frequency fields. Diya's helpers may add a generic name, dose warning, or Urdu explanation. The response includes language-specific notes and a safety reminder.

## Run locally

Requires Python 3.10 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` and set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. Use a Claude model that supports image input. Never commit `.env` or share your API key.

Start the server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Visit `http://127.0.0.1:8000/docs` for the interactive API page. `GET /health` checks whether the server is running. `POST /extract` expects `file` (JPEG, PNG, GIF, or WebP; maximum 10 MB) and `language` (`English` or `Urdu`). For Expo Go on a phone, set `mobile/.env` to `EXPO_PUBLIC_API_URL=http://YOUR-MAC-IP:8000` and keep the phone and Mac on the same Wi-Fi.

## Run the mobile app

Follow [mobile/README.md](mobile/README.md) to connect the app to the server and open it in Expo Go.

## Shared files

- `main.py`: HTTP endpoints, image upload handling, Claude request, and errors.
- `extract.py`: calls the shared helpers in order for each medicine.
- `helpers.py`: stable placeholders for `match_brand()`, `check_dose()`, and `explain_urdu()`.
- `.env.example`: required environment variable names, with no secrets.
