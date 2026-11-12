# Steadier: project rules

- Follow `docs/design-language.md` for every UI change.
- **Never sign in as the owner or create access passes** (session tokens, keys, login links) without asking the owner first, even temporarily.
- **Never deploy with a failing test.** Run the full suite (`pnpm check` and `pnpm test`) green, take a backup (`bash scripts/backup-db.sh`), then deploy.
- **After showing a mock-up, wait for the owner's yes before building.**
- No priority, scores or ranking. No data changes, orphan-rule changes or confirmation changes without the owner's approval.
