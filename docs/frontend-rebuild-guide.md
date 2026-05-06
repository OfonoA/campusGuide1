# Frontend Rebuild Guide

This guide is for a developer building a new frontend for ArASSIST from scratch.

It intentionally ignores the current frontend codebase. Treat the backend API and system behavior as the contract.

## Goal

Build a role-based web client for three user types:

- `student`
- `ar_staff`
- `admin`

The frontend should support:

- authentication
- student AI chat
- ticket escalation and ticket chat
- AR staff ticket workflow
- admin ticket assignment, user management, and document management

## System Model

ArASSIST is a support platform for MUST with two support layers:

1. AI chat for students
2. Human support through Academic Registrar tickets when AI cannot answer confidently

The backend owns all business rules:

- users authenticate with JWT access tokens and refresh tokens
- students chat with the assistant
- unresolved chats can escalate into tickets
- only assigned AR staff can work a ticket
- closed tickets are read-only

Do not rebuild backend logic in the frontend. The UI should reflect backend state, not infer its own.

## Recommended Frontend Architecture

Use a modern SPA with:

- React
- TypeScript
- React Router
- a server-state layer such as TanStack Query
- a small auth state store via context or Zustand
- a typed API client layer separated from UI components

Suggested structure:

```text
src/
  app/
  routes/
  pages/
  components/
  features/
    auth/
    chat/
    tickets/
    admin/
    ar/
  api/
  hooks/
  types/
  utils/
```

Prefer feature-based organization over page-only organization.

## Core Screens

### Public

- Login
- Signup

### Student

- Chat workspace
- Chat history list
- Ticket list
- Ticket detail / ticket conversation view

### AR Staff

- Assigned tickets queue
- Ticket conversation view
- Resolution workflow view

### Admin

- Ticket inbox / assignment board
- User management
- Document management
- Ingestion status
- AR activity view

## Auth Model

The backend exposes:

- `POST /api/signup`
- `POST /api/login`
- `GET /api/check_auth`
- `POST /api/refresh`
- `POST /api/logout`

### Login Response

`POST /api/login` returns:

```json
{
  "token": "jwt",
  "token_type": "bearer",
  "refresh_token": "refresh-token",
  "user": {
    "id": 1,
    "username": "alice",
    "role": "student",
    "name": null,
    "email": null
  }
}
```

### Signup Response

`POST /api/signup` returns:

```json
{
  "token": "jwt",
  "token_type": "bearer",
  "refresh_token": "refresh-token"
}
```

The access token also contains `user_id`, `username`, and `role`, so the UI can recover session state from the JWT if needed.

### Auth Rules

- Send `Authorization: Bearer <token>` on protected requests.
- On `401`, try `POST /api/refresh` once using the stored refresh token.
- If refresh fails, clear session and redirect to login.
- Role-based route guards should be frontend convenience only. The backend remains the real authority.

## Role Routing

After login, route by role:

- `student` -> student workspace
- `ar_staff` -> AR ticket dashboard
- `admin` -> admin dashboard

Keep a single shared app shell if possible, but split role-specific navigation.

## Student Experience

### Chat

Main endpoint:

- `POST /chat/`

Request:

```json
{
  "query": "When are office hours?",
  "chat_history": [["Hi", "Hello"]],
  "chat_id": 12
}
```

Response:

```json
{
  "response": "text",
  "chat_id": 12,
  "ticket_reference": null
}
```

Important behavior:

- If `chat_id` is absent, the backend creates a new conversation.
- If the assistant cannot answer reliably, the backend may create a ticket automatically and return a `ticket_reference`.
- If a conversation already has an active ticket, the backend stops further chatbot use for that conversation and tells the user to continue in ticket chat.

### Chat History

- `GET /api/chats`
- `GET /api/chats/{chat_id}/messages`
- `GET /api/chats/{chat_id}/active-ticket`

Use these to build:

- left sidebar conversation history
- chat transcript page
- “continue in ticket chat” state

Message objects include:

- `id`
- `conversation_id`
- `sender`
- `content`
- `timestamp`
- `found_answer`

### Feedback and Escalation

Endpoints:

- `POST /api/chat/{message_id}/feedback`
- `POST /api/chat/{conversation_id}/request-officer`

Use feedback only on bot messages.

Feedback payload:

```json
{
  "satisfactory": false,
  "request_in_person": true
}
```

Behavior:

- positive feedback stores a rating only
- negative feedback can ask for officer help
- explicit officer request can also create a ticket from a conversation
- the backend prevents duplicate active tickets for the same conversation

Frontend guidance:

- show thumbs up/down or equivalent rating UI on bot messages
- if the student gives negative feedback, offer “Talk to an officer”
- if a ticket already exists, use the returned reference and route to ticket view instead of showing duplicate escalation UI

## Ticket Experience

Ticket endpoints:

- `GET /api/tickets`
- `GET /api/tickets/{ticket_id}`
- `GET /api/tickets/{ticket_id}/messages`
- `POST /api/tickets/{ticket_id}/messages`

### Important Ticket Rules

- students can read and write their own tickets unless closed
- AR staff can read and write only tickets assigned to them
- admins can read all tickets
- closed tickets are read-only

### Ticket Transcript Shape

The ticket transcript may contain:

- original chat conversation messages
- AI bot messages
- ticket thread messages between student and officer

The API already returns anonymized aliases like:

- `Student-<reference>`
- `Officer-<reference>`
- `ArASSIST`

Use those labels directly instead of trying to map raw user identities for the transcript.

## AR Staff Experience

Endpoints:

- `GET /api/ar/tickets`
- `GET /api/ar/tickets/{ticket_id}/conversation`
- `POST /api/ar/tickets/{ticket_id}/start`
- `POST /api/ar/tickets/{ticket_id}/resolve`
- `POST /api/ar/tickets/{ticket_id}/close`

### AR Workflow

Ticket lifecycle:

- `open` -> admin assigns
- `assigned` -> AR staff starts
- `in_progress` -> AR staff resolves
- `resolved` -> AR staff closes
- `closed` -> finished

Frontend constraints:

- only show `Start` for `assigned`
- only show `Resolve` for `in_progress`
- only show `Close` for `resolved`
- do not assume AR staff can touch all AR tickets; only assigned tickets are valid

Resolution payload:

```json
{
  "actions_taken": "Explained policy and provided next steps",
  "resolution_summary": "Resolved."
}
```

Build the AR ticket page around the backend lifecycle rather than a generic chat UI.

## Admin Experience

Endpoints:

- `GET /api/admin/tickets`
- `POST /api/admin/tickets/{ticket_id}/assign?officer_id={id}`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/{user_id}/role`
- `GET /api/admin/documents`
- `POST /api/admin/documents/upload`
- `DELETE /api/admin/documents/{document_id}`
- `GET /api/admin/ingestion-status`
- `GET /api/admin/ar-activity`
- `POST /api/admin/ingest-reinforcement`

### Admin Ticket Inbox

`GET /api/admin/tickets` returns:

- `ticket_id`
- `reference_code`
- `student_id`
- `student_username`
- `status`
- `ar_assigned_id`
- `ar_assigned_username`
- `created_at`
- `resolved_at`

Use this as the primary admin inbox table. It is now aligned with the actual current assignment state.

### User Management

Admins can:

- list users
- create users with explicit roles
- change a user role

Do not expose role changes to non-admin users in the UI.

### Document Management

Admin and AR staff can upload/delete policy PDFs used by RAG.

The upload endpoint is multipart form-data, not JSON.

Upload response includes:

- `stored_filename`
- `rag_document_id`
- `chunks_created`

This should be treated as an operations tool, not a polished end-user content manager.

## Data Types To Define Up Front

Create stable frontend types for:

- `AuthUser`
- `TokenResponse`
- `Chat`
- `ChatMessage`
- `ChatResponse`
- `Ticket`
- `TicketMessage`
- `AdminTicket`
- `AdminUser`
- `AdminDocument`
- `ARActivityItem`
- `IngestionStatusItem`

Do not spread raw `any` responses through components.

## API Client Design

Build a dedicated API layer with:

- one axios/fetch client
- auth token injection
- one refresh-token retry path
- centralized error normalization

Group endpoints by domain:

- `authApi`
- `chatApi`
- `ticketApi`
- `arApi`
- `adminApi`

Keep response mapping in the API layer so page components consume normalized shapes.

## Error Handling

Plan for these backend outcomes:

- `401` invalid or expired token
- `403` role or ownership violation
- `404` chat, ticket, or message not found
- `400` invalid lifecycle action such as resolving the wrong status
- `500` ingestion or backend failure

UI guidance:

- show inline form errors for login/signup
- show recoverable toasts for request failures
- show empty states instead of blank tables
- show “session expired” flow on auth failure

## Loading and Refresh Strategy

Recommended server-state behavior:

- chats list: cache briefly, refetch on chat creation
- chat messages: fetch on screen open, append optimistic local user message only if you are ready to reconcile carefully
- tickets list: refetch on new ticket creation and status changes
- admin inbox: poll lightly or offer manual refresh
- AR assigned tickets: refresh after every workflow action

Avoid complex optimistic updates for ticket lifecycle transitions unless necessary. These actions are stateful and role-sensitive.

## Suggested Routing Map

Example route structure:

```text
/login
/signup
/app/chat
/app/chat/:chatId
/app/tickets
/app/tickets/:ticketId
/ar/tickets
/ar/tickets/:ticketId
/admin/tickets
/admin/users
/admin/documents
/admin/ingestion
/admin/activity
```

## Recommended Build Order

1. Auth shell and protected routing
2. Student chat page and chat history
3. Student ticket list and ticket detail
4. AR assigned-ticket queue and ticket workflow
5. Admin ticket inbox and assignment flow
6. Admin users and document management
7. Polish, accessibility, and responsiveness

## Non-Negotiable UX Rules

- never show controls the current role cannot use
- never assume a ticket is writable without checking backend status
- route students away from chatbot continuation when a conversation has an active ticket
- treat backend messages as authoritative, especially around escalation and lifecycle status
- preserve conversation and ticket references clearly in the UI

## Practical Implementation Notes

- backend CORS expects configured origins; run the new frontend from an allowed origin
- access tokens are short-lived; refresh flow is required
- the backend still serves legacy HTML routes, but the new frontend should be treated as a standalone client
- ticket and chat domains overlap but are not the same thing; keep them as separate frontend features

## What To Ignore

Ignore the current frontend implementation entirely:

- do not mirror its component structure
- do not inherit its state model
- do not preserve its styling or routing

The source of truth is:

- backend routes
- backend schemas
- backend role and lifecycle rules

## Final Advice

Build the new frontend around backend state transitions, not visual screens.

If the data model is clean in your client layer, the rest of the application will stay manageable:

- auth is token plus role
- chat is conversation plus messages
- escalation is ticket creation
- support is ticket lifecycle plus ticket transcript
- admin is operational oversight, not end-user messaging
