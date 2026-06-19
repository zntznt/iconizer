# Batch 06 — Deploy to GitHub Pages (Phase 6)

Goal: every push to `main` builds the Vite app and publishes it to GitHub Pages.
Static, client-side only — no backend, nothing to configure server-side.

Depends on a working `npm run build`. Read PLAN.md.

## Pre-flight — verify the `base` FIRST

The #1 Pages failure for a Vite project site is a `base` mismatch: build and
deploy both succeed, but the live URL is a BLANK PAGE because asset paths point at
`/assets/...` instead of `/iconizer/assets/...`. Symptom = 404s on JS/CSS in the
browser console, not a build error.

- Confirm `vite.config.ts` has `base: '/iconizer/'` (already set in scaffold).
- This is a project site, so the URL will be `https://zntznt.github.io/iconizer/`.
  (If a custom domain or user-site is ever used, `base` changes — note it, don't
  pre-handle it.)

## The workflow — `.github/workflows/deploy.yml`

Use the official Pages Actions (no third-party deploy action needed):

    name: Deploy to Pages
    on:
      push:
        branches: [main]
    permissions:
      contents: read
      pages: write
      id-token: write
    concurrency:
      group: pages
      cancel-in-progress: true
    jobs:
      build:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: actions/setup-node@v4
            with: { node-version: 20, cache: npm }
          - run: npm ci
          - run: npm run build
          - uses: actions/upload-pages-artifact@v3
            with: { path: dist }
      deploy:
        needs: build
        runs-on: ubuntu-latest
        environment:
          name: github-pages
          url: ${{ steps.deployment.outputs.page_url }}
        steps:
          - id: deployment
            uses: actions/deploy-pages@v4

Notes:
- `npm ci` needs `package-lock.json` committed (the builder generated it — confirm
  it's tracked).
- Vite outputs to `dist/` by default — that's the artifact path.
- `permissions` + `id-token: write` are required by `deploy-pages@v4`; omitting
  them is the second-most-common failure.

## One-time repo setting (manual, can't be scripted from here)

In GitHub: **Settings -> Pages -> Build and deployment -> Source = GitHub Actions**
(not "Deploy from a branch"). This is a click in the UI; flag it to the user as the
one manual step. The workflow won't publish until this is set.

## Self-check

No code logic here, so no assert. Verification is operational:

- After the first push with the workflow + the Pages source set: the Actions run
  goes green, and `https://zntznt.github.io/iconizer/` loads the app (not a blank
  page, no asset 404s in console).
- If blank: re-check `base`. If 403/permission error: re-check the `permissions:`
  block and that Pages Source = GitHub Actions.

## Done when

- `.github/workflows/deploy.yml` committed to `main`.
- Pages Source set to GitHub Actions (user does this once).
- The live URL serves the working app.

## Out of scope

Custom domain, preview deploys per branch (that's a Vercel feature; we chose Pages),
caching/CDN tuning (Pages handles it).
