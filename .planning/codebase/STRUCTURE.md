# Codebase Structure

**Analysis Date:** 2026-02-21

## Directory Layout

```text
add-jipi/
├── .planning/               # Planning artifacts for GSD workflows
│   └── codebase/            # Generated codebase mapping documents
├── addon.js                 # Stremio addon manifest and handlers
├── serverless.js            # HTTP entry point and runtime orchestration
├── package.json             # Node package metadata and scripts
├── vercel.json              # Vercel build and route mapping
└── .gitignore               # Ignored local/generated paths
```

## Directory Purposes

**`.planning/`:**
- Purpose: Persist generated planning and mapping documentation.
- Contains: Markdown docs under `codebase/`.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`.

**Project root (`add-jipi/`):**
- Purpose: Flat runtime code and deployment config for a single serverless addon.
- Contains: Executable JavaScript entry files and JSON config.
- Key files: `serverless.js`, `addon.js`, `package.json`, `vercel.json`.

## Key File Locations

**Entry Points:**
- `serverless.js`: Main exported request handler used by deployment routing.
- `package.json`: Local start command entry (`node serverless.js`).

**Configuration:**
- `package.json`: Runtime type, scripts, and dependency declarations.
- `vercel.json`: Build target (`@vercel/node`) and catch-all route forwarding to `serverless.js`.
- `.gitignore`: Excluded runtime artifacts and dependencies.

**Core Logic:**
- `addon.js`: Stremio manifest, catalog handler, stream resolver, broker client helper.
- `serverless.js`: Routing, request controls, Redis access, stream cache, quarantine/health pages.

**Testing:**
- Not detected (no `*.test.*`, `*.spec.*`, or test configuration files in repository root).

## Naming Conventions

**Files:**
- Use lowercase root-level JavaScript filenames with role-oriented names: `addon.js`, `serverless.js`.
- Use lowercase JSON config names tied to platform/tooling: `package.json`, `vercel.json`.

**Directories:**
- Use dot-prefixed directories for tooling/meta assets: `.planning`.
- Keep operational code flat at repository root (no `src/` split currently).

## Where to Add New Code

**New Feature:**
- Primary code: Add Stremio protocol behavior in `addon.js`; add HTTP/runtime orchestration in `serverless.js`.
- Tests: Create a new `tests/` directory at repo root (for example `tests/addon.test.js`) because no test structure exists yet.

**New Component/Module:**
- Implementation: Add new root-level module files (for example `redis-client.js`, `request-controls.js`) and import from `serverless.js`.

**Utilities:**
- Shared helpers: Extract reusable functions from `serverless.js` or `addon.js` into dedicated root modules and keep names aligned to responsibility.

## Special Directories

**`.planning/codebase/`:**
- Purpose: Stores generated architecture/quality/stack concern documents.
- Generated: Yes
- Committed: Yes

**`.git/`:**
- Purpose: Git metadata and object database.
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-02-21*
