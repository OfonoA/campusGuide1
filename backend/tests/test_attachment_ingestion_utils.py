from app.utils import (
    build_ingestion_text,
    build_stored_message_content,
    strip_attachment_ingestion_content,
)


def test_attachment_content_hidden_from_display_but_available_for_ingestion():
    stored = build_stored_message_content(
        "Please review the attached files.\n\n[Attached files: answer.pdf]",
        ["[File: answer.pdf]\nResolved policy text from the PDF."],
    )

    assert strip_attachment_ingestion_content(stored) == (
        "Please review the attached files.\n\n[Attached files: answer.pdf]"
    )
    assert build_ingestion_text(stored) == (
        "Please review the attached files.\n\n[Attached files: answer.pdf]\n\n"
        "[File: answer.pdf]\nResolved policy text from the PDF."
    )


def test_plain_message_content_is_unchanged_without_hidden_attachment_payload():
    content = "Officer reply without attachments."

    assert strip_attachment_ingestion_content(content) == content
    assert build_ingestion_text(content) == content
