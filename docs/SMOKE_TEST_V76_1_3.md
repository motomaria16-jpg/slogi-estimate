# SLOGI v76.1.3 — Shared Workspace Purge Hotfix

Status: local candidate evidence. Production Supabase deployment is not part of this hotfix.

## Defect and scope

Gate I proved that the existing UI moved a deleted object to `workspace.trash.projects`, but permanent purge removed only the trash copy. The same object remained in shared `state.locations` with `deletedAt` and could be restored into later snapshots.

The hotfix changes only the browser domain layer:

- soft-delete remains recoverable;
- purge accepts only IDs already present in trash;
- purge removes the authorized ID from trash and locations;
- purge-all removes every trashed ID while preserving active locations;
- existing shared-workspace debounce/CAS persists the combined snapshot;
- migrations, RLS, Edge Functions and production backend contracts are unchanged.

## Executed regression evidence

| Check | Result |
|---|---:|
| Soft delete creates a recoverable trash entry | PASS |
| Purge one physically removes only the trashed location | PASS |
| Active non-trash location cannot be purged | PASS |
| Purge all removes trashed locations and preserves active locations | PASS |
| Reload does not resurrect purged objects | PASS |
| Shared CAS persists locations and trash together | PASS |
| Second local session reads the purged remote snapshot | PASS |
| PT409 preserves winner and conflict draft | PASS |
| PT409 automatic retry flood | Absent |
| New shared purge tests | 5 PASS / 0 FAIL |
| Existing workspace CAS source guard | 7 PASS / 0 FAIL |
| Cian/release unit-fixture suite | 35 PASS / 0 FAIL |
| Frontend JavaScript parse | 24/24 PASS |
| Edge TypeScript loading | 6/6 PASS |
| HTML/Markdown local references | 73 documents, 26 references, 0 missing |
| Repository diff whitespace audit | PASS |
| Secret scan (tracked/untracked/ignored) | 295 text files, 0 findings |
| Frozen migrations and Edge runtime diff from v76.1.2 | 0 changed |

Canonical-LF evidence for the hotfix surface:

- `professional-core.js`: `62489ba5a812872fe5ccb0b9543941e20c26a75a5c70dece078df1fc5c92acae`;
- `settings.html`: `bdc019b18b1995ccad23bdab45b86ec191a2c45b5f59022752b2ebeda4c622a7`;
- `tests/shared-workspace-purge.test.mjs`: `33d182d4c9e6989d1b8cc292a155ae8f9ad9d046cd0fe386a376ec94290c380f`.

## Release gate

All local checks listed above were executed on the candidate worktree. Pages post-publish evidence is recorded after publication. A production two-profile workspace E2E remains a separate owner-authorized gate and is not replaced by these local tests.
