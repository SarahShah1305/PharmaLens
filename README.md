# PharmaLens

PharmaLens is an Expo mobile app with a Python API. A user chooses English or Urdu, then uploads or takes a prescription photo. The server sends it to Gemini 3.5 Flash-Lite for a cautious transcription and bilingual reading. It is a reading aid, not a doctor: it does not diagnose or change medicines. Users should confirm details with a pharmacist or doctor. Unreadable writing should be returned as `unclear`, never guessed.

The Expo app is in `mobile/`; Sara's FastAPI server is in the repository root. Diya's helpers are in `helpers.py`, with a small, source-linked brand and generic reference list in `medicines.csv`.

## Sara's server starter

The FastAPI server accepts an image and `language` (`English` or `Urdu`) at `POST /extract`, sends it to Gemini, then passes each medicine through the helper functions in `helpers.py`.

The response includes English and Urdu prescription transcriptions, plus a `medicines` array. Each medicine keeps the agreed `name`, `dose`, `frequency`, and `confidence` fields and includes bilingual dose and frequency fields. Helpers add `brand_name`, `generic_name`, a cautious `dose_warning`, and an `explanation` in the selected language. Unknown brands and medicine purposes remain unclear rather than being guessed. Dose checks are limited warnings and cannot confirm a dose is safe. The response includes language-specific notes and a safety reminder.

## Run locally

Requires Python 3.10 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit the copied `.env` file: replace its Anthropic example lines with `GEMINI_API_KEY=your-key-here`. The server defaults to `gemini-3.5-flash-lite`; you can optionally set another supported Gemini model using `GEMINI_MODEL`. Never commit `.env` or share your API key. The repository's `.env.example` stays unchanged.

Start the server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Visit `http://127.0.0.1:8000/docs` for the interactive API page. `GET /health` checks whether the server is running. `POST /extract` expects `file` (JPEG, PNG, GIF, or WebP; maximum 10 MB) and `language` (`English` or `Urdu`). For Expo Go on a phone, set `mobile/.env` to `EXPO_PUBLIC_API_URL=http://YOUR-MAC-IP:8000` and keep the phone and Mac on the same Wi-Fi.

For the hosted web app, configure `EXPO_PUBLIC_API_URL` to the API's public HTTPS URL in the web build environment. The API allows `https://pharmalens.expo.app` by default; add other preview origins through the server's comma-separated `CORS_ORIGINS` setting. Redeploy the API after server-setting changes and rebuild/redeploy the web app after changing `EXPO_PUBLIC_API_URL`. Keep `GEMINI_API_KEY` only on the API server.

## Accuracy evaluation

After Person 5 shares the labeled prescription photos and answer CSV, save them in a local folder. The CSV needs `image,name,dose,frequency` columns; each row represents one medicine, and `image` names its photo. If a photo has multiple medicines, repeat its filename once per medicine and add a zero-based `medicine_index` column to identify each result in order. An optional `language` column selects `English` or `Urdu` for each request.

With the API server running, run:

```bash
python accuracy.py answers.csv prescription_photos --api http://127.0.0.1:8000 --out results.json
```

The report records normalized exact-match accuracy for medicine name, dose, and frequency separately, plus the number of records where all three fields match. Review individual records and errors in `results.json` before reporting the percentages. The script reuses each response when a photo has multiple labeled medicines, so it makes one Gemini API request per unique photo and language.

## Run the mobile app

Follow [mobile/README.md](mobile/README.md) to connect the app to the server and open it in Expo Go.

## Shared files

- `main.py`: HTTP endpoints, image upload handling, Gemini request, and errors.
- `extract.py`: calls the shared helpers in order for each medicine.
- `helpers.py`: `match_brand()`, `check_dose()`, and `explain(name, language)` with `en` and `ur` language codes.
- `medicines.csv`: editable brand, generic-name, and simple-use reference data.
- `accuracy.py`: reproducible comparison of server results against Person 5's labeled CSV.
- `.env.example`: required environment variable names, with no secrets.
