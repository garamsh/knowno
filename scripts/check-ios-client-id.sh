#!/bin/sh
# Fails when the iOS URL scheme Google Sign-In returns to differs from the iOS client
# ID the app is configured with. Info.plist cannot read a value passed by
# --dart-define-from-file, so it holds the client ID reversed (ADR 0006); this keeps
# the two copies equal.
set -euf

config=app/config/dev.json
plist=app/ios/Runner/Info.plist

cd "$(dirname "$0")/.."

client_id=$(jq -er '.GOOGLE_IOS_CLIENT_ID' "$config")
expected="com.googleusercontent.apps.${client_id%.apps.googleusercontent.com}"
if ! grep -qF "<string>$expected</string>" "$plist"; then
	echo "$plist has no URL scheme $expected, the reversed GOOGLE_IOS_CLIENT_ID of $config" >&2
	echo "found: $(grep -o 'com\.googleusercontent\.apps\.[^<]*' "$plist" || echo none)" >&2
	exit 1
fi
echo "$plist has the URL scheme of GOOGLE_IOS_CLIENT_ID in $config"
