#!/usr/bin/env sh
set -eu

suspicious=$(docker compose exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL'
SELECT COUNT(*)
FROM (
  SELECT payload FROM sync_changes
  UNION ALL
  SELECT payload FROM sync_entities
) AS synced
WHERE payload::text ~* '"(raw_json|api_key_id|encrypted_key|extra_credentials|authorization|accessToken|refreshToken|apiKey|password|secret)"[[:space:]]*:';
SQL
)
suspicious=$(printf '%s' "$suspicious" | tr -d '[:space:]')
[ "$suspicious" = 0 ] || {
  printf '%s\n' "privacy audit failed: $suspicious suspicious database payload(s)" >&2
  exit 1
}

logs=$(docker compose logs --no-color app 2>&1)
if printf '%s\n' "$logs" | grep -Eiq \
  '"(authorization|accessToken|refreshToken|raw_json|api_key_id|encrypted_key|extra_credentials|apiKey|password|secret)"[[:space:]]*:|Bearer[[:space:]]+[A-Za-z0-9._-]{16,}'; then
  printf '%s\n' 'privacy audit failed: suspicious application log content found' >&2
  exit 1
fi

printf '%s\n' 'privacy audit passed'
