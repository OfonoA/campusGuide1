import os
import uuid
import json
import pytest
import httpx


BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8000")
ADMIN_USER = os.getenv("ADMIN_USER", "admin1")
ADMIN_PASS = os.getenv("ADMIN_PASS", "AdminPass123!")

AR_PASS = "ArPass123!"
STUDENT_PASS = "StudentPass123!"

PDF_PATH = os.getenv(
    "TEST_PDF_PATH",
    os.path.join(os.path.dirname(__file__), "..", "university_documents", "MUST Postgraduate Handbook 2018.pdf"),
)
RUN_DOC_UPLOAD = os.getenv("RUN_DOC_UPLOAD", "0") == "1"


def _login(client: httpx.Client, username: str, password: str) -> str:
    r = client.post(f"{BASE_URL}/api/login", json={"username": username, "password": password})
    r.raise_for_status()
    return r.json()["token"]


def _admin_create_user(client: httpx.Client, token: str, username: str, password: str, role: str) -> int:
    r = client.post(
        f"{BASE_URL}/api/admin/users",
        headers={"Authorization": f"Bearer {token}"},
        json={"username": username, "password": password, "role": role},
    )
    r.raise_for_status()
    return r.json()["id"]


@pytest.mark.skipif(not os.getenv("OPENAI_API_KEY"), reason="OPENAI_API_KEY not set")
def test_full_backend_flow():
    with httpx.Client(timeout=60.0) as client:
        # Admin login
        print("1) Admin login")
        admin_token = _login(client, ADMIN_USER, ADMIN_PASS)

        # Create AR staff + student
        print("2) Admin creates AR staff + student")
        ar_user = f"ar_{uuid.uuid4().hex[:8]}"
        student_user = f"student_{uuid.uuid4().hex[:8]}"
        ar_id = _admin_create_user(client, admin_token, ar_user, AR_PASS, "ar_staff")
        _admin_create_user(client, admin_token, student_user, STUDENT_PASS, "student")

        # Student login
        print("3) Student login")
        student_token = _login(client, student_user, STUDENT_PASS)

        # Student chat
        print("4) Student chat")
        chat_resp = client.post(
            f"{BASE_URL}/chat/",
            headers={"Authorization": f"Bearer {student_token}"},
            json={"query": "When are office hours?", "chat_history": []},
        )
        chat_resp.raise_for_status()
        chat_id = chat_resp.json()["chat_id"]

        # Fetch messages to get bot message id
        print("5) Fetch chat messages and locate bot message")
        msgs = client.get(
            f"{BASE_URL}/api/chats/{chat_id}/messages",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        msgs.raise_for_status()
        bot_msgs = [m for m in msgs.json() if m.get("sender") == "bot"]
        assert bot_msgs, "No bot message found"
        bot_message_id = bot_msgs[-1]["id"]

        # Feedback -> request officer (ticket)
        print("6) Feedback triggers ticket")
        fb = client.post(
            f"{BASE_URL}/api/chat/{bot_message_id}/feedback",
            headers={"Authorization": f"Bearer {student_token}"},
            json={"satisfactory": False, "request_in_person": True},
        )
        fb.raise_for_status()
        ticket_ref = fb.json().get("ticket_reference")
        assert ticket_ref, "Ticket reference not returned"

        # Admin list tickets and find ticket id
        print("7) Admin lists tickets and finds new ticket")
        tickets = client.get(
            f"{BASE_URL}/api/admin/tickets",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        tickets.raise_for_status()
        ticket_id = None
        for t in tickets.json():
            if t.get("reference_code") == ticket_ref:
                ticket_id = t["ticket_id"]
                break
        assert ticket_id is not None, "Ticket not found in admin list"

        # Admin assigns ticket
        print("8) Admin assigns ticket to AR officer")
        assign = client.post(
            f"{BASE_URL}/api/admin/tickets/{ticket_id}/assign",
            params={"officer_id": ar_id},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assign.raise_for_status()

        # AR login
        print("9) AR staff login")
        ar_token = _login(client, ar_user, AR_PASS)

        # Student sends ticket message
        print("10) Student sends ticket message")
        sm = client.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/messages",
            headers={"Authorization": f"Bearer {student_token}"},
            json={"content": "Hello officer, I need help."},
        )
        sm.raise_for_status()

        # AR sends ticket message
        print("11) AR sends ticket message")
        am = client.post(
            f"{BASE_URL}/api/tickets/{ticket_id}/messages",
            headers={"Authorization": f"Bearer {ar_token}"},
            json={"content": "Thanks, here is the answer."},
        )
        am.raise_for_status()

        # Verify anonymized aliases
        print("12) Verify anonymized aliases")
        tmsgs = client.get(
            f"{BASE_URL}/api/tickets/{ticket_id}/messages",
            headers={"Authorization": f"Bearer {student_token}"},
        )
        tmsgs.raise_for_status()
        aliases = {m["sender_alias"] for m in tmsgs.json()}
        assert any(a.startswith("Student-") for a in aliases)
        assert any(a.startswith("Officer-") for a in aliases)

        # Verify first AR message auto-started the ticket
        print("13) Verify automatic in-progress transition")
        ar_tickets = client.get(
            f"{BASE_URL}/api/ar/tickets",
            headers={"Authorization": f"Bearer {ar_token}"},
        )
        ar_tickets.raise_for_status()
        matching_ticket = next((t for t in ar_tickets.json() if t.get("id") == ticket_id), None)
        assert matching_ticket is not None, "Assigned ticket not visible to AR staff"
        assert matching_ticket.get("status") == "in_progress", "Ticket did not move to in_progress after first AR reply"

        # Resolve
        print("14) AR resolves ticket")
        res = client.post(
            f"{BASE_URL}/api/ar/tickets/{ticket_id}/resolve",
            headers={"Authorization": f"Bearer {ar_token}"},
            json={"actions_taken": "Explained policy", "resolution_summary": "Resolved."},
        )
        res.raise_for_status()

        # Verify ingestion status
        print("15) Verify ingestion status")
        ingest = client.get(
            f"{BASE_URL}/api/admin/ingestion-status",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        ingest.raise_for_status()
        assert any(i.get("ticket_id") == ticket_id and i.get("ingested") for i in ingest.json())

        # Upload PDF (optional; can be slow due to embeddings)
        if RUN_DOC_UPLOAD and os.path.exists(PDF_PATH):
            print("16) Upload, list, and delete document")
            with open(PDF_PATH, "rb") as f:
                up = client.post(
                    f"{BASE_URL}/api/admin/documents/upload",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    files={"file": (os.path.basename(PDF_PATH), f, "application/pdf")},
                )
            up.raise_for_status()
            doc_id = up.json()["rag_document_id"]

            # List docs
            docs = client.get(
                f"{BASE_URL}/api/admin/documents",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            docs.raise_for_status()
            assert any(d["id"] == doc_id for d in docs.json())

            # Delete doc
            dele = client.delete(
                f"{BASE_URL}/api/admin/documents/{doc_id}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            dele.raise_for_status()
