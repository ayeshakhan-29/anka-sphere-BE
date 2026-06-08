# Anka Sphere — Backend API

REST API for the Anka Sphere internal agency operations dashboard. Built with **Fastify**, **Prisma 7**, and **PostgreSQL**.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| Framework | Fastify 5 |
| ORM | Prisma 7 |
| Database | PostgreSQL |
| Auth | JWT (`@fastify/jwt`) |
| Validation | Zod |
| Language | TypeScript 6 (strict) |

## Project Structure

```
anka-sphere-BE/
├── prisma/
│   ├── schema.prisma        # Full data model
│   └── seed.ts              # Seeds default users + sample project
├── src/
│   ├── plugins/
│   │   ├── prisma.ts        # PrismaClient plugin (pg adapter)
│   │   └── auth.ts          # JWT plugin + authenticate preHandler
│   ├── routes/
│   │   ├── auth.ts          # POST /auth/register, /auth/login, GET /auth/me
│   │   └── projects.ts      # Full project CRUD + profiling + milestones
│   ├── schemas/
│   │   ├── auth.ts          # Zod schemas for auth endpoints
│   │   └── project.ts       # Zod schemas for project endpoints
│   ├── middleware/
│   │   └── error-handler.ts # Global error handler (Zod, Prisma, HTTP errors)
│   ├── app.ts               # Fastify app factory
│   └── server.ts            # Entry point
├── prisma.config.ts         # Prisma 7 config (datasource URL)
├── .env.example             # Environment variable template
└── tsconfig.json
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set your database connection string:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/anka_sphere?schema=public"
JWT_SECRET="your-secret-here"
```

### 3. Create the database

```bash
createdb anka_sphere
```

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Seed default data

```bash
npm run db:seed
```

This creates 4 default users and one sample project:

| Email | Password | Role |
|---|---|---|
| admin@anka.agency | password | ADMIN |
| james@anka.agency | password | DEVELOPER |
| sara@anka.agency | password | DESIGNER |
| liam@anka.agency | password | SEO |

### 6. Start the dev server

```bash
npm run dev
```

Server runs at `http://localhost:3000`.

---

## API Reference

All protected routes require a `Bearer` token in the `Authorization` header.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | No | Create a new user account |
| POST | `/auth/login` | No | Login and receive JWT |
| GET | `/auth/me` | Yes | Get current user profile |

#### POST /auth/login

```json
// Request
{ "email": "admin@anka.agency", "password": "password" }

// Response
{ "token": "eyJ...", "user": { "id": "...", "email": "...", "name": "...", "role": "ADMIN" } }
```

---

### Projects

| Method | Path | Description |
|---|---|---|
| GET | `/projects` | List all projects |
| POST | `/projects` | Create a new project |
| GET | `/projects/:id` | Get project with full details |
| PATCH | `/projects/:id` | Update project fields |
| DELETE | `/projects/:id` | Delete a project |

#### POST /projects

```json
{
  "name": "Brand Refresh",
  "clientName": "Lumina Studios",
  "description": "Full rebrand and website.",
  "startDate": "2026-06-01T00:00:00.000Z",
  "targetDate": "2026-09-01T00:00:00.000Z"
}
```

Creating a project automatically seeds all 5 pipeline stages (`PROFILING` → `IN_PROGRESS`, the rest `LOCKED`).

---

### Project Profiling (Stage 1)

| Method | Path | Description |
|---|---|---|
| PUT | `/projects/:id/profiling` | Upsert profiling data (brief, brand, SEO) |
| POST | `/projects/:id/profiling/complete` | Approve profiling — triggers Hard Gate |
| POST | `/projects/:id/profiling/personas` | Add a persona |
| PATCH | `/projects/:id/profiling/personas/:personaId` | Update a persona |
| DELETE | `/projects/:id/profiling/personas/:personaId` | Remove a persona |
| POST | `/projects/:id/profiling/competitors` | Add a competitor |
| PATCH | `/projects/:id/profiling/competitors/:compId` | Update a competitor |
| DELETE | `/projects/:id/profiling/competitors/:compId` | Remove a competitor |

#### Hard Gate — POST /projects/:id/profiling/complete

Validates that `companyName`, `objectives`, and `primaryKeywords` are filled. On success, runs a transaction that:
- Marks Profiling stage as `APPROVED`
- Unlocks Written Content to `IN_PROGRESS`
- Advances `project.currentStage` to `WRITTEN_CONTENT`

---

### Milestones

| Method | Path | Description |
|---|---|---|
| GET | `/projects/:id/milestones` | List milestones for a project |
| POST | `/projects/:id/milestones` | Add a milestone |
| PATCH | `/projects/:id/milestones/:msId` | Update a milestone |
| DELETE | `/projects/:id/milestones/:msId` | Remove a milestone |

---

## Database Schema

The Prisma schema covers the full delivery pipeline:

```
User
Project  ──< ProjectMember
         ──< PipelineEntry    (one row per stage × project)
         ──< Milestone
         ──  ProjectProfiling ──< Persona
                               ──< Competitor
         ──  WrittenContent   ──< ContentPage ──< Comment
         ──< Comment
```

### Pipeline Stages

```
PROFILING → WRITTEN_CONTENT → DESIGN → DEVELOPMENT → MARKETING
  Hard Gate     Hard Gate      Soft Gate  Soft Gate     —
```

### Roles

`ADMIN` · `MANAGER_PRODUCT_MODELLING` · `MANAGER_PRODUCT_DEVELOPMENT` · `MANAGER_PRODUCT_GROWTH` · `CONTENT_WRITER` · `DESIGNER` · `DEVELOPER` · `SOCIAL_MEDIA` · `PAID_ADS` · `SEO`

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production server |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:push` | Push schema changes without migration file |
| `npm run db:seed` | Seed default users and sample data |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |
| `npm run db:generate` | Regenerate Prisma client after schema changes |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_SECRET` | `change-me-in-production` | JWT signing secret |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `NODE_ENV` | `development` | Environment |
| `LOG_LEVEL` | `info` | Pino log level |
| `FRONTEND_URL` | `http://localhost:4200` | Allowed CORS origin |
