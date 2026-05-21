# Repository Guidelines

## Project Structure & Module Organization
This repository is a Yarn-based monorepo centered on NestJS services. `apps/` contains deployable applications such as `core` (catalog+inventory 통합 백엔드), `membership`, `user-service`, `channel-adapter`, `search`, and `analytics`, plus the standalone Medusa service in `apps/medusa` and web frontends in `apps/admin-web` and `apps/wallet-web`. Shared code lives in `libs/{shared,db,events,authorization}/src`, reusable typed packages live in `packages/`, automation lives in `scripts/`, and reference material lives in `docs/` or `apps/*/docs`.

## Build, Test, and Development Commands
Use Yarn at the repository root.

- `yarn build`: build the main Nest applications defined in the root workspace.
- `yarn start:<service>:dev`: run a service in watch mode, for example `yarn start:main:dev` (core server) or `yarn start:user-service:dev`.
- `yarn lint`: run ESLint with autofix across `apps/`, `libs/`, and `test/`.
- `yarn format`: apply Prettier to TypeScript files under `apps/` and `libs/`.
- `yarn test`, `yarn test:cov`: run the default Jest suite or coverage.
- `yarn test:user-service`, `yarn test:membership`: run targeted suites.
- `npm run db:setup`: interactive dev wrapper that bootstraps logical DBs, runs `drizzle-kit migrate`, and seeds. For non-interactive / deploy paths use the split commands `db:bootstrap` / `db:migrate` / `db:seed:ref` / `db:seed:demo` (see ADR-0005). Service-specific drizzle generation is exposed as `db:generate:*`.

## Coding Style & Naming Conventions
TypeScript is the default language. Prettier enforces single quotes, trailing commas, 120-character lines, and standard 2-space indentation. Follow existing naming patterns: kebab-case filenames like `channel-adapter.service.ts`, PascalCase classes, and camelCase functions and variables. Prefer workspace aliases such as `@app/*` and `@packages/*` over deep relative imports.

## Testing Guidelines
Jest is the standard test runner. Use `*.spec.ts` or `*.test.ts` filenames, keep e2e tests in `apps/*/test`, and place Medusa HTTP integration tests in `apps/medusa/integration-tests/http`. WMS tests use Testcontainers and run serially, so Docker must be available locally. There is no global coverage threshold configured, but new changes should ship with focused tests or updated fixtures.

## Commit & Pull Request Guidelines
Recent commits use short imperative subjects with optional scopes, often bracketed: `[medusa] ...`, `[channel-adapter] ...`, `[users] ...`, or `fix: ...`. Keep each commit scoped to one service or library. PRs should state the impacted apps/libs, required env or migration changes, commands/tests run, and linked issues. Include screenshots for `apps/admin-web` or `apps/wallet-web` UI changes.

## Configuration Tips
Do not commit real secrets. Start from `envs/`, `env-templates/`, or each app's `.env.example`/`.env.template`, and keep local overrides untracked. For Medusa work, `apps/medusa/docker-compose.yml` is the local dependency baseline.
