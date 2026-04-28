# Release Checklist

Use this checklist before tagging a release.

1. Run `npm run verify`.
2. Confirm `docs/PATCH_MANIFEST.md` still matches `scripts/build-manifest.js`.
3. Confirm `config/firebase-client.env` or shell env is available for the build.
4. Confirm the Tauri runtime does not depend on `--disable-web-security`.
5. Run `npm run build:frontend` and confirm `dist/assets/{abilities,attacks,item,status,types}/` contains versioned atlas JSON/PNG files.
6. Confirm `dist/tilemap/` contains generated `*.json` tilemaps, including `AmpPlains.json`.
7. Build installers with `npm run tauri:build`.
8. Sign installers with `npm run release:sign`; CI must provide `TAURI_PRIVATE_KEY` and `TAURI_PRIVATE_KEY_PASSWORD` (the current GitHub secret names can still be `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
9. Generate updater metadata with `npm run release:manifest`.
10. Run `npm run verify:release` before uploading release assets.
11. Upload the MSI, NSIS installer, both `.sig` files, and `latest.json` to the GitHub release.
12. After publishing, run `npm run verify:updater` and confirm the live `latest.json` advertises the same version as `package.json`.
13. Confirm release notes and public docs match the current feature set and support matrix.
14. Confirm only validated platforms are being published.
