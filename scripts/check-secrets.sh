#!/bin/sh
# Fails when a Supabase secret key or service-role key is in a file this repository
# tracks or would track. A secret key starts with sb_secret_; a legacy service-role
# key is a JWT whose payload has "role": "service_role". Publishable and anon keys are
# public by design and pass. Every file is read, not a chosen directory, so the count
# is printed with $scope, and a match prints only its file, never the key.
set -euf

scope="git ls-files --cached --others --exclude-standard"

cd "$(dirname "$0")/.."

count=0
status=0
while IFS= read -r file; do
	[ -f "$file" ] || continue
	count=$((count + 1))
	if grep -IqE 'sb_secret_[A-Za-z0-9_-]{8,}' "$file"; then
		echo "$file: holds a Supabase secret key (sb_secret_...)"
		status=1
	fi
	roles=$(grep -IoE 'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' "$file" |
		jq -Rr 'split(".")[1] | gsub("-"; "+") | gsub("_"; "/")
			| . + ("=" * ((4 - length % 4) % 4)) | @base64d | fromjson? | .role? // empty') || true
	if printf '%s\n' "$roles" | grep -qx 'service_role'; then
		echo "$file: holds a Supabase service-role key (a JWT with role service_role)"
		status=1
	fi
done <<LIST
$(eval "$scope")
LIST

echo "checked $count files for Supabase secret and service-role keys, selected by: $scope"
if [ "$count" -eq 0 ]; then
	echo "no file was read" >&2
	exit 1
fi
exit "$status"
