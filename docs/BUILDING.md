# Building VioletWire Android

Install Node.js 22 or newer, JDK 21, and the Android SDK with platform 36 and
build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` for your system.

```sh
npm ci
npm run typecheck
npm run android:sync
chmod +x android/gradlew
android/gradlew -p android :app:assembleDebug :app:lintDebug
```

On Windows, use `android\gradlew.bat -p android` instead of `android/gradlew` and
omit `chmod`. Your debug APK is at
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Signed public releases

Official releases preserve application ID `io.github.garries420.violetwire` and
the existing signing certificate. Every new version needs a strictly increasing
Android `versionCode`, a matching version in `src/android/update-service.ts`,
`package.json`, Gradle `versionName` and the release tag. Add new changelog entries
above older entries in both changelog files.

Configure these private environment variables to assemble an official release:
`VIOLETWIRE_KEYSTORE_PATH`, `VIOLETWIRE_KEYSTORE_PASSWORD`,
`VIOLETWIRE_KEY_ALIAS`, `VIOLETWIRE_KEY_PASSWORD`. Then run
`android/gradlew -p android :app:assembleRelease :app:lintRelease`.
Keystores and credentials must stay out of source control and GitHub release assets.
The release signing certificate SHA-256 is
`3c7bf232d82d213749e9ccff21698036d72ca831f4031901d8d2c9b89e879958`.

Before publishing each release, verify its signature, hash and metadata, then
install the exact APK over the preceding public APK and check retained settings.
If a verified incompatibility requires uninstalling the old version, attach
`READ ME BEFORE INSTALL.txt` to that specific release. Explain the cause, affected
versions, steps and data loss. Normally compatible updates do not include that file.

GitHub Actions runs one Android build job for changes to source or build inputs,
or when manually requested. README-only changes do not trigger it. Official APKs
are published separately after their signing and upgrade checks.
