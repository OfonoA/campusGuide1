from app.utils import chunk_text


def test_chunk_text_makes_progress_for_large_single_sentence_text():
    text = "A" * 1200 + "."

    chunks = chunk_text(text, chunk_size=800, chunk_overlap=200)

    assert chunks
    assert len(chunks) >= 2
    assert all(chunk for chunk in chunks)
    assert "".join(chunks).replace(" ", "").startswith("A" * 800)
