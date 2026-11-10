#!/bin/bash
# Rebuild the signed Steadier APK and publish it at /download.
# Before rebuilding for an update: bump versionCode in app/build.gradle.
set -e
cd "$(dirname "$0")"
docker build -q -t steadier-android-build build-env >/dev/null
mkdir -p ~/.cache/steadier-gradle
docker run --rm -u "$(id -u):$(id -g)" -e GRADLE_USER_HOME=/gradle-cache \
  -v ~/.cache/steadier-gradle:/gradle-cache -v "$PWD":/project \
  -v ~/steadier-android-keys:/keys:ro steadier-android-build gradle --no-daemon -q assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../downloads/steadier.apk
echo "Published ../downloads/steadier.apk"
