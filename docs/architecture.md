Living document — update these diagrams when adding features.
# BibleApp — Architecture

A pnpm-workspace TypeScript monorepo (scaffolded on Replit, 2026-11-03) for the "Build Your Translation" Bible app — a second front end over the Bible project's corpus, alongside BibleApp-pwa. It is at scaffold stage: the API surface is a health check only, the database schema package is an empty stub, and the reading UI runs on a bundled corpus data file whose interfaces are written as the contract for the project's future API. Deployment targets Vercel (Vite build) with Replit as the authoring environment.

Packages: `artifacts/api-server` (Express 5 API, esbuild CJS bundle, port 5000 in dev), `artifacts/build-your-translation` (Vite + React front end, wouter routing, TanStack Query), `artifacts/mockup-sandbox` (design mockups), `lib/api-spec` (OpenAPI 3.1 spec + Orval codegen), `lib/api-client-react` and `lib/api-zod` (generated client hooks and Zod schemas), `lib/db` (Drizzle ORM + PostgreSQL access; requires `DATABASE_URL`).

## Context diagram

```mermaid
flowchart LR
    DEV["Developer (Kit, via Replit and GitHub)"]
    READER["Reader (web user)"]
    VERCEL["Vercel (build and hosting)"]
    PG["PostgreSQL database (DATABASE_URL)"]
    BAPI["Bible project API on Lampy (future corpus and search provider)"]

    subgraph SYS["BibleApp monorepo"]
        CORE["Front end, API server, shared libraries"]
    end

    DEV -->|"source code and configuration"| CORE
    CORE -->|"build artifacts (Vite and esbuild bundles)"| VERCEL
    VERCEL -->|"served web app"| READER
    CORE -->|"schema pushes and queries (Drizzle)"| PG
    BAPI -.->|"verse embeddings and corpus API (planned provider)"| CORE
```

## Level-1 DFD

```mermaid
flowchart TD
    DEV["Developer (Kit, via Replit and GitHub)"]
    READER["Reader (web user)"]
    PG["PostgreSQL database (DATABASE_URL)"]

    D1[("D1 OpenAPI specification (lib/api-spec/openapi.yaml)")]
    D2[("D2 Generated client libraries (lib/api-client-react and lib/api-zod)")]
    D3[("D3 Bundled corpus data (src/data/corpus.ts)")]
    D4[("D4 Drizzle schema package (lib/db/src/schema)")]
    D5[("D5 React application source (artifacts/build-your-translation/src)")]

    DEV -->|"API contract edits"| P1["1.0 Maintain the OpenAPI contract"]
    P1 -->|"specification file"| D1
    D1 -->|"codegen input"| P2["2.0 Generate client hooks and schemas"]
    P2 -->|"generated hooks and Zod schemas"| D2
    DEV -->|"corpus export"| P3["3.0 Bundle corpus content"]
    P3 -->|"verse and word constants"| D3
    D3 -->|"corpus reads"| P4["4.0 Render reading and interlinear views"]
    D5 -->|"components and pages"| P4
    P4 -->|"rendered web app"| READER
    DEV -->|"route and server changes"| P5["5.0 Serve the API"]
    D1 -->|"contract conformance"| P5
    P5 -->|"health status responses"| READER
    DEV -->|"schema definitions"| P6["6.0 Push database schema"]
    P6 -->|"Drizzle table definitions"| D4
    D4 -->|"schema push (development only)"| PG
    P5 -.->|"future corpus and search queries"| PG
```

## ER diagram

No persistent tables exist yet: `lib/db/src/schema/index.ts` is an empty export with template guidance only. The data model that exists today is the front end's TypeScript corpus model (`src/data/corpus.ts`), drawn below; it is the contract the future API provider must match.

```mermaid
erDiagram
    VERSE {
        string id PK "verse identifier"
        string book
        int chapter
        int number
        string reference
        string kjv "KJV text"
        string youngs "Young's text"
    }
    WORD {
        string id PK "graphic-word occurrence id"
        string hebrew
        string transliteration
        string strongs "Strong's number (lexeme id)"
        string gloss
        string grammar
        string kjv
        string youngs
    }
    VERSE_PART {
        string text "display segment"
        string wordId FK "optional link to WORD"
        string strongs "optional Strong's reference"
    }
    WITNESS_NOTE {
        string witness PK "witness name (with its verse)"
        string text
    }
    SEARCH_RESULT {
        string verseId FK "contract for the future embeddings search"
        string provider "bundled provider today; project API later"
    }
    VERSE ||--o{ WORD : "contains"
    VERSE ||--o{ VERSE_PART : "displays as (kjvParts and youngsParts)"
    WORD ||--o{ VERSE_PART : "aligned by"
    VERSE ||--o{ WITNESS_NOTE : "annotated by"
    VERSE ||--o{ SEARCH_RESULT : "returned by"
```

## Grounding notes

- OBSERVED (repo tree, HEAD `c242a6e5` 2026-11-05): pnpm-workspace monorepo — artifacts/api-server, artifacts/build-your-translation, artifacts/mockup-sandbox; lib/api-client-react, lib/api-spec, lib/api-zod, lib/db; scripts/ package; `.replit` and `replit.md` present.
- OBSERVED (replit.md): stack is pnpm workspaces, Node.js 24, TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, Zod v4, Orval codegen from the OpenAPI spec, esbuild CJS bundle; required env `DATABASE_URL`; API server dev port 5000.
- OBSERVED (lib/api-spec/openapi.yaml): the entire API contract is one operation — GET `/healthz` returning `HealthStatus{status}` — under base path `/api`.
- OBSERVED (artifacts/api-server/src/routes/): only `health.ts` is implemented; routes/index.ts wires it.
- OBSERVED (lib/db/src/schema/index.ts): `export {}` — no Drizzle tables are defined; the file is template guidance. The ERD therefore models the front-end corpus types, not a database.
- OBSERVED (artifacts/build-your-translation/src/data/corpus.ts): the bundled corpus is declared "the single source of corpus content"; Word ids identify graphic-word occurrences (Strong's identifies lexemes); VersePart arrays are explicit display-order alignments; Young's alignment is computed, not a published interlinear. Its SearchResult contract names the project's own future search engine: verse embeddings, nomic-embed-text, 768 dimensions, one vector per verse, served by the project's API — the bundled provider implements the same async contract.
- OBSERVED (artifacts/build-your-translation/src/App.tsx): the routed UI is still the scaffold (placeholder Home reading "Replit Agent is building...", plus a not-found page) — the corpus data layer is ahead of the pages.
- OBSERVED (commit c242a6e5): Vite env defaults (PORT, BASE_PATH) were added for Vercel builds — Vercel is the deployment target.
- INFERRED: the planned flow from the Bible project API (Lampy) into this app is drawn dotted — corpus.ts states the contract and the replacement point, but no API call exists in the code yet.
