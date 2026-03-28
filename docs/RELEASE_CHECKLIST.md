# Release Checklist

Use this checklist before tagging a release.

1. Run `npm run verify`.
2. Confirm `docs/PATCH_MANIFEST.md` still matches `scripts/build-manifest.js`.
3. Confirm `config/firebase-client.env` or shell env is available for the build.
4. Confirm the Tauri runtime does not depend on `--disable-web-security`.
5. Confirm release notes and public docs match the current feature set and support matrix.
6. Confirm updater metadata and signing configuration are present in CI secrets.
7. Confirm only validated platforms are being published.

