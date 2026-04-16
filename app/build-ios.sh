#!/bin/bash
# Build iOS preview APK. Set EXPO_TOKEN in ~/.zshrc or pass inline:
#   EXPO_TOKEN=... ./build-ios.sh
if [ -z "$EXPO_TOKEN" ]; then
  echo "EXPO_TOKEN env var is required"
  exit 1
fi
cd "$(dirname "$0")"
npx eas-cli build --platform ios --profile preview
