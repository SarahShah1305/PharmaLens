# PharmaLens mobile app

Expo / React Native app for reading English and Urdu prescription photos. The app sends a selected photo and language choice to Sara's FastAPI server; it does not contain the Anthropic API key.

## Run in Expo Go

1. In this folder, create your local config: `cp .env.example .env`.
2. Edit `.env` and replace `YOUR-MAC-IP` with your Mac's local Wi-Fi IP address. On a Mac, `ipconfig getifaddr en0` often shows it. Use a URL such as `http://192.168.1.24:8000`.
3. Start the server from the repository root in another terminal. Follow the root README and bind it to `0.0.0.0` so your phone can reach it.
4. Make sure the phone and Mac are on the same Wi-Fi network.
5. From this folder, run `npx expo start` and scan the QR code with Expo Go.

Expo Go runs the development app; it is not a public deployment. Deploy the API separately before testing away from your development network. Build an Android APK after the mobile app and API workflow have been reviewed.

## API response expected

`POST /extract` accepts multipart fields `file` and `language` (`English` or `Urdu`). Each medicine result keeps the shared `name`, `dose`, `frequency`, and `confidence` fields. It also returns bilingual fields such as `dose_english` and `dose_urdu`. Diya's `explain_urdu()` helper may add `urdu_explanation` after she implements it.
