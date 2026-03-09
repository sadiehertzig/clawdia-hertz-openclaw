# Checker Allowlist

Allowed commands:

- `./gradlew build`
- `./gradlew test`
- `./gradlew spotlessCheck`
- `./gradlew check`

Checker runs in a temporary request-scoped workspace copy.

Disallowed:

- arbitrary shell commands
- destructive git history edits
- unapproved network write operations
