# ArASSIST

ArASSIST is a React + FastAPI support platform for MUST (Mbarara University of Science and Technology) that combines:

- Student AI chat support (RAG + OpenAI)
- Automatic escalation to ticketing when answers are not found
- AR staff workflow for assigned tickets
- Admin tools for ticket assignment, user management, and document ingestion

## Architecture

- Frontend: React + TypeScript SPA in `frontend/`
- Backend: FastAPI API in `backend/`
- Development model: run Vite and FastAPI separately
- Backend responsibility: API, auth, ticketing, RAG, ingestion, admin workflows
- Frontend responsibility: all user-facing routes and UI

The backend no longer serves `index.html`, `login.html`, or `signup.html`. All app pages are owned by the React frontend.

## Current System Overview

### 1. Student Flow
- Student signs up or logs in.
- Student chats with ArASSIST.
- If the system cannot answer confidently, a support ticket is created automatically.
- Student continues communication through the ticket thread.

### 2. AR Staff Flow
- AR staff view assigned tickets.
- AR staff can move tickets through lifecycle:
  - `assigned -> in_progress -> resolved -> closed`
- AR staff can resolve tickets with optional resolution details.

### 3. Admin Flow
- Admin views ticket inbox and assigns open tickets to AR staff.
- Admin manages users and roles.
- Admin uploads/deletes policy PDFs used by RAG.
- Admin can trigger reinforcement ingestion.

---

## Tech Stack

### Backend
- FastAPI
- SQLAlchemy
- MySQL (`pymysql`)
- JWT auth (`python-jose`)
- Password hashing (`passlib[bcrypt]`)
- FAISS vector store
- LangChain + OpenAI embeddings/completions

### Frontend
- React + TypeScript
- Vite
- Axios
- Tailwind CSS
- Recharts

---

## Project Structure

```text
backend/
  alembic/
  app/
    main.py
    auth.py
    llm.py
    vector_store.py
    admin/routes.py
    ar/routes.py
    feedback/routes.py
    tickets/routes.py
    reinforcement/routes.py
  database/
    database.py
    orm_models.py
    init_db.py
  scripts/
    ingest_documents.py
    initial_crawl.py
  university_documents/

frontend/
  index.html
  package.json
  src/
    pages/
    components/
    contexts/
    services/api.ts
```

---

## Environment Variables

Create a `.env` file for the backend in the project root or `backend/`. Frontend variables should live in `frontend/.env` when needed.

Required/used variables:

```env
# Backend
OPENAI_API_KEY=your_openai_api_key
DATABASE_URL=mysql+pymysql://root:password@localhost/campus_guide_ar
SECRET_KEY=replace_with_secure_random_value
REFRESH_TOKEN_EXPIRE_DAYS=30
SQL_ECHO=false
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Frontend (optional override)
VITE_API_BASE_URL=http://localhost:8000
```

Notes:
- `SECRET_KEY` is required in production. In local development, the backend currently falls back to a development key if it is unset.
- `DATABASE_URL` is required at startup.
- `SQL_ECHO` is optional and defaults to `false`.
- `CORS_ALLOWED_ORIGINS` is optional; if unset, the backend allows local Vite and local backend origins only.

---

## Setup Instructions

### 1) Clone and enter project
```bash
cd /path/to/campg\ V1.0
```

### 2) Python environment
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3) Frontend dependencies
```bash
cd frontend
npm install
cd ..
```

### 4) Initialize database tables
Run from project root:
```bash
python -m backend.database.init_db
```

---

## Running the System

Use two terminals in development.

### Terminal A: Backend
```bash
source venv/bin/activate
cd backend
uvicorn app.main:app --reload
```

Backend default URL:
- `http://127.0.0.1:8000`

### Terminal B: Frontend
```bash
cd frontend
npm run dev
```

Frontend default URL (Vite):
- `http://127.0.0.1:5173`

Open the app in the frontend URL, not the backend URL.

---

## Authentication and Roles

Roles in the system:
- `student`
- `ar_staff`
- `admin`

Auth endpoints:
- `POST /api/signup`
- `POST /api/login`
- `GET /api/check_auth`
- `POST /api/refresh`
- `POST /api/logout`

JWT access token is used in `Authorization: Bearer <token>`.

Role-based frontend routes are convenience only. Backend authorization remains the source of truth.

---

## Core API Modules

### Chat and Conversations
- `POST /chat/`
- `GET /api/chats`
- `GET /api/chats/{chat_id}/messages`
- `GET /api/chats/{chat_id}/active-ticket`

### Ticket Messaging (role-aware)
- `GET /api/tickets`
- `GET /api/tickets/{ticket_id}`
- `GET /api/tickets/{ticket_id}/messages`
- `POST /api/tickets/{ticket_id}/messages`

### AR Staff
- `GET /api/ar/tickets`
- `GET /api/ar/tickets/{ticket_id}/conversation`
- `POST /api/ar/tickets/{ticket_id}/start`
- `POST /api/ar/tickets/{ticket_id}/resolve`
- `POST /api/ar/tickets/{ticket_id}/close`

### Student Feedback / Escalation
- `POST /api/chat/{message_id}/feedback`
- `POST /api/chat/{conversation_id}/request-officer`

### Admin
- `GET /api/admin/tickets`
- `POST /api/admin/tickets/{ticket_id}/assign`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/{user_id}/role`
- `GET /api/admin/documents`
- `POST /api/admin/documents/upload`
- `DELETE /api/admin/documents/{document_id}`

### Reinforcement
- `POST /api/admin/ingest-reinforcement`

---

## RAG / Document Ingestion

Policy and institutional PDFs are ingested into FAISS and used as context for AI responses.

Script:
```bash
cd backend
python scripts/ingest_documents.py
```

Startup behavior:
- Backend attempts to load existing FAISS index (`faiss_index`) on startup.

## Development Notes

- This repository uses a single frontend implementation: the React SPA in `frontend/`.
- Legacy static frontend files have been removed to avoid duplicate login/signup/chat implementations.
- Do not commit generated directories such as `frontend/node_modules`, `frontend/dist`, Python caches, or local FAISS/database artifacts.

---

## Test Notes

There is an end-to-end backend test file:
- `backend/tests/test_backend_e2e.py`

It uses environment variables like:
- `BASE_URL`
- `ADMIN_USER`
- `ADMIN_PASS`
- `OPENAI_API_KEY`
- optional `RUN_DOC_UPLOAD`

---

## Known Development Notes

- Some test and build commands depend on your local Python and Node versions.
- Ensure the configured MySQL database exists before running table initialization.
- Some endpoints/UI areas are guarded in both frontend and backend, but backend enforcement is the security boundary.
