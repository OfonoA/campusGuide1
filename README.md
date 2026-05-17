# ArASSIST

ArASSIST is an AI-powered academic support platform for MUST (Mbarara University of Science and Technology). It combines student chat support, knowledge-based answers, ticket escalation for complex cases, AR staff workflows, and admin analytics in one system.

## What It Does

- Students ask academic support questions through chat.
- The AI answers routine questions from verified institutional knowledge.
- Unresolved or complex cases escalate into support tickets.
- AR staff review, reply to, and resolve assigned cases.
- Admins manage users, assignments, documents, ingestion, and performance visibility.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, Recharts
- Backend: FastAPI, SQLAlchemy, MySQL, JWT auth
- AI and retrieval: OpenAI, FAISS, BM25, LangChain
- Content pipeline: PDF ingestion, web scraping, scheduled freshness checks

## Repo Layout

```text
frontend/                 React SPA for students, AR staff, and admins
backend/                  FastAPI app, database models, auth, retrieval, tickets
backend/app/admin/        Admin routes, analytics, documents, assignment workflows
backend/app/ar/           AR staff ticket workflows
backend/app/feedback/     Student feedback and escalation routes
backend/app/reinforcement/  Resolved-ticket ingestion pipeline
backend/app/scraper/      Web crawling, extraction, freshness, scheduler
backend/tests/            Backend API and retrieval tests
```

## Core Product Flows

### Student

- Sign up or log in
- Start a chat with ArASSIST
- Receive an answer or trigger ticket escalation
- Continue follow-up through the ticket thread when needed

### AR Staff

- View assigned tickets
- Move tickets through `assigned`, `in_progress`, `resolved`, and `closed`
- Reply with updates, guidance, and final resolution details

### Admin

- Review ticket inbox and assign cases
- Manage users and AR staff assignment profiles
- Upload and delete knowledge-base documents
- Monitor analytics, staff performance, and ingestion status

## Environment Variables

Backend values are loaded with `python-dotenv`, so you can place them in a root `.env` or `backend/.env`.

```env
# Backend
DATABASE_URL=mysql+pymysql://root:password@localhost/campus_guide_ar
OPENAI_API_KEY=your_openai_api_key
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_REQUEST_TIMEOUT_SECONDS=20
SECRET_KEY=replace_with_a_secure_random_value
REFRESH_TOKEN_EXPIRE_DAYS=30
SQL_ECHO=false
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Frontend
VITE_API_BASE_URL=http://localhost:8000
```

Notes:

- `DATABASE_URL` is required.
- `OPENAI_API_KEY` is required for live AI and embedding features.
- `SECRET_KEY` is required in production. In local development the backend falls back to a development key if unset.
- Frontend overrides go in [frontend/.env.example](</Users/ofono/Desktop/campg V1.0/frontend/.env.example:1>) format, usually as `frontend/.env`.

## Local Setup

### 1. Install backend dependencies

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Initialize the database

```bash
python -m backend.database.init_db
```

For a brand-new local database, `init_db` is enough to create tables.

If you already have an existing database, apply Alembic migrations as well so newer schema changes are added:

```bash
cd backend
alembic upgrade head
```

## Running the App

Use two terminals.

### Backend

```bash
source venv/bin/activate
cd backend
uvicorn app.main:app --reload
```

Backend URL:

- `http://127.0.0.1:8000`

### Frontend

```bash
cd frontend
npm run dev
```

Frontend URL:

- `http://localhost:3000`

Open the frontend URL in the browser. The React app owns the UI; the backend is API-only.

## Roles

- `student`
- `ar_staff`
- `admin`

The frontend uses role-based routing for convenience, but backend authorization remains the source of truth.

## Main API Areas

### Auth

- `POST /api/signup`
- `POST /api/login`
- `GET /api/check_auth`
- `POST /api/refresh`
- `POST /api/logout`

### Student chat

- `POST /chat/`
- `GET /api/chats`
- `GET /api/chats/{chat_id}/messages`
- `GET /api/chats/{chat_id}/active-ticket`
- `POST /api/chat/{message_id}/feedback`
- `POST /api/chat/{conversation_id}/request-officer`

### Tickets

- `GET /api/tickets`
- `GET /api/tickets/{ticket_id}`
- `GET /api/tickets/{ticket_id}/messages`
- `POST /api/tickets/{ticket_id}/messages`
- `GET /api/attachments/{attachment_id}/download`
- `GET /api/attachments/{attachment_id}/view`

### AR staff

- `GET /api/ar/tickets`
- `GET /api/ar/tickets/{ticket_id}/conversation`
- `POST /api/ar/tickets/{ticket_id}/start`
- `POST /api/ar/tickets/{ticket_id}/resolve`
- `POST /api/ar/tickets/{ticket_id}/close`

### Admin

- `GET /api/admin/tickets`
- `POST /api/admin/tickets/{ticket_id}/assign`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/{user_id}/role`
- `GET /api/admin/documents`
- `POST /api/admin/documents/upload`
- `DELETE /api/admin/documents/{document_id}`
- `GET /api/admin/ingestion-status`

## Testing

Backend tests live in `backend/tests/`.

Run the test suite from the project root:

```bash
pytest backend/tests
```

The end-to-end test in [backend/tests/test_backend_e2e.py](</Users/ofono/Desktop/campg V1.0/backend/tests/test_backend_e2e.py:1>) expects a running backend, seeded credentials, and `OPENAI_API_KEY` for live AI behavior.

## Knowledge and Ingestion Tooling

- PDF ingestion scripts live in `backend/scripts/`
- Web crawling and freshness scheduling live in `backend/app/scraper/`
- Reinforcement ingestion for resolved tickets lives in `backend/app/reinforcement/`

Useful scripts include:

- `python backend/scripts/ingest_documents.py`
- `python backend/scripts/initial_crawl.py`
- `python backend/scripts/accuracy_report.py`

## Current Notes

- The backend starts a scraper scheduler during app startup.
- Attachments are supported in chat and ticket workflows.
- The React frontend is the only UI entrypoint; legacy server-rendered pages are no longer used.
