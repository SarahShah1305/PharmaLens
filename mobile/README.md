# PharmaLens mobile app

Expo / React Native app for reading English and Urdu prescription photos. The app sends a selected photo and language choice to Sara's FastAPI server; it does not contain the Anthropic API key.

The result screen includes a frequency-based schedule preview, a read-aloud control, confidence and unclear-field highlights, and a local history of up to 30 readings. History stores the extracted text on this device only; it does not save prescription photos. Schedule entries are a visual preview, not alarms or new dosing instructions.

## Run in Expo Go

1. In this folder, copy `.env.example` to `.env` (`Copy-Item .env.example .env` in Windows PowerShell).
2. Set `EXPO_PUBLIC_API_URL=http://<computer-IPv4>:8000`. On Windows, find the IPv4 address with `ipconfig`; use the Wi-Fi adapter address.
3. Start the server from the repository root in another terminal. Follow the root README and bind it to `0.0.0.0` so your phone can reach it.
4. Make sure your phone and computer are on the same Wi-Fi network.
5. From this folder, run `npm install` once, then `npx expo start --clear` and scan the QR code with Expo Go.

Expo Go runs the development app; it is not a public deployment. Deploy the API separately before testing away from your development network. Build an Android APK after the mobile app and API workflow have been reviewed.

## API response expected

`POST /extract` accepts multipart fields `file` and `language` (`English` or `Urdu`). Each medicine result keeps the shared `name`, `dose`, `frequency`, and `confidence` fields. It also returns bilingual fields such as `dose_english` and `dose_urdu`, plus an optional language-specific `explanation` and dose warning.
