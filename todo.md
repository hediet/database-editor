# TODO

## Features

- [ ] **Support syncing partial/limited exports** - Currently, files exported with `--limit` contain `$partial` markers and cannot be synced back (to prevent accidental data loss). Consider:
  - Using the base file for three-way merge to detect which rows were actually deleted vs. just not exported
  - Adding a `--force` flag to allow partial sync with explicit user consent
  - Only applying changes to rows that exist in the partial export (no deletes for missing rows)
