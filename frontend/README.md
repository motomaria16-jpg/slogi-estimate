# SLOGI frontend on Nuxt 4

The application UI is implemented as a Nuxt 4 single-page experience with server-rendered entry documents and static generation for GitHub Pages. The existing domain modules remain the source of truth for search, clusters, workflow, calendar, shared workspace and proposal document generation.

## Local development

```powershell
pnpm install
pnpm dev
```

The pre-dev hook copies the required domain modules and document assets from the repository root into `public/legacy`. The copied directory is generated and is not committed.

## Verification

```powershell
pnpm typecheck
pnpm generate
```

Static output is written to `.output/public` and contains the original public paths:

- `/available-spaces.html` — search;
- `/in-work.html` — active premises and calendar;
- `/proposal.html` — commercial proposals;
- `/under-development.html` — sections not yet implemented.

## Architecture

- `app/layouts/default.vue` keeps one persistent shell and sidebar while Nuxt changes the content route without a full page reload.
- `app/components/PremisesCard.vue` is the shared compact list card for Search, In work and Proposal pages.
- `app/components/PropertyCardModal.vue` is the canonical property card. It composes Object, Accompaniment and Proposal tabs without duplicating the object.
- `app/composables` adapt the existing repositories and domain services to Vue state.
- `app/plugins/legacy.client.ts` loads the tested domain modules in a deterministic order after hydration.
- `scripts/sync-legacy-assets.mjs` contains the explicit allow-list of domain and document files shipped with the frontend.

No password, access token or service key is embedded in Vue components. Authentication, shared workspace access and server endpoints continue to use the existing runtime configuration.

## Deployment

Run `pnpm generate` and publish the complete contents of `.output/public` at the site root. The `.html` route names are intentionally retained so existing bookmarks and links keep working.
