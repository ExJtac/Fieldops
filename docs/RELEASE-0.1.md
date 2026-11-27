# CAS FieldOps 0.1 pilot release

Released November 26, 2026 (America/Denver).

- Product page: https://cas-tx.com/Tracking/
- Public read-only demo: https://cas-tx.com/Tracking/app/
- MIT source repository: https://github.com/ExJtac/cas-fieldops
- Deployed application source: `d491d4e` on `codex/initial-release`.
- Local project: `CAS FieldOps` under the user's ChatGPT projects directory.

## Verification completed

29 automated tests passed locally; the initial GitHub Actions build/test run also passed. Tests cover inventory transaction integrity, BOM revision review, assignment conflicts, approved-time accounting, role/tenant isolation, HTTP authentication, evidence access, export filtering, bulk crew time, credential/session revocation and backup/recovery. The production TypeScript/Vite build passed.

Browser verification on the writable local demonstration confirmed sign-in, a 33-unit synthetic conduit receipt with updated remaining quantity, persistence after reload, a submitted 8-hour timecard approving into actual labor, the four-person weekly resource board, and narrow-screen navigation. At the tested 390px viewport, page width was 375px with scrollable table interiors. No browser console errors were observed during that pass. The saved preview is an actual local demonstration screenshot, not a design mockup.

Public HTTP verification confirmed 200 responses for the promotion, screenshot, stylesheet, app shell, generated JavaScript/CSS, health and workspace endpoints; the workspace reported read-only mode. A public project mutation was rejected with 403. XLSX report download succeeded with the expected MIME type. The promotion HTML matched the local artifact byte for byte. The open-source catalog links to `/Tracking/`, and the existing sitemap now includes that page.

The public demo uses its own database, read-only server configuration and a dedicated process with CPU/memory limits. It is not a writable customer installation. No shared demo password is published. A database must carry an explicit demo marker before the read-only public mode can expose its records.

The CAS-TX routing change adds one scoped Caddy import. Existing application process IDs were identical before and after. CAS Gantt, SiteScribe, CrewClock, CrewBooks, Inventory, Lumen and Bidlark returned HTTP 200 at their checked public entrypoints. Bidlark code and data were not modified.

## Release recovery notes

Public-demo code is at `/home/deploy/cas-fieldops/releases/20261126-v010`; its separate SQLite file is under `/home/deploy/cas-fieldops/data`. The `cas-fieldops` service listens on loopback port 4328. Promotion files are under `/var/www/cas-fieldops/releases/20261126-v010/Tracking`. The route import is `/etc/caddy/cas-fieldops.caddy`.

The prior Caddy configuration, catalog page and sitemap are retained under `/var/backups/cas-fieldops/20261126-v010`. Do not blindly restore those complete files after subsequent site edits. To withdraw FieldOps, remove only its import from the current Caddyfile, validate and reload; remove only its catalog card/sitemap URL; stop only the `cas-fieldops` service. Preserve unrelated additions and all databases.

This release does not claim completion of the advanced features listed in [acceptance scope](ACCEPTANCE.md), a commercial security audit, or a live Bidlark integration. Docker instructions are included, but a Docker image build was not executed on the local Mac during this release.
