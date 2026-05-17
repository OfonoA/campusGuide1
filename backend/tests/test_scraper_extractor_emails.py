from app.scraper.extractor import _decode_cloudflare_email, extract_html_page


def _encode_cloudflare_email(email: str, key: int = 0x6E) -> str:
    return f"{key:02x}" + "".join(f"{ord(char) ^ key:02x}" for char in email)


def test_decode_cloudflare_email_restores_plain_address():
    encoded = _encode_cloudflare_email("[email protected]")
    assert _decode_cloudflare_email(encoded) == "[email protected]"


def test_extract_html_page_replaces_cloudflare_placeholder_email():
    encoded = _encode_cloudflare_email("[email protected]")
    html = """
    <html>
      <head><title>Registrar Contact</title></head>
      <body>
        <main>
          <p>Academic Registrar: Martha Kyoshaba Twinamasiko (PhD)</p>
          <p>
            Email:
            <a href="/cdn-cgi/l/email-protection#ENCODED_EMAIL">
              <span class="__cf_email__" data-cfemail="ENCODED_EMAIL">[email protected]</span>
            </a>
          </p>
        </main>
      </body>
    </html>
    """.replace("ENCODED_EMAIL", encoded)

    result = extract_html_page("https://www.must.ac.ug/contact", html, {})

    assert "[email protected]" in result.clean_text
    assert "data-cfemail" not in result.clean_text


def test_extract_html_page_replaces_placeholder_variant_with_spacing():
    encoded = _encode_cloudflare_email("[email protected]")
    html = """
    <html>
      <head><title>CITT Contact</title></head>
      <body>
        <main>
          <p>For general inquiries related to CITT, contact the Faculty Administrator.</p>
          <p>
            Email:
            <a href="https://www.must.ac.ug/cdn-cgi/l/email-protection#ENCODED_EMAIL">
              [email protected]
            </a>
            or
            <a href="/cdn-cgi/l/email-protection#ENCODED_EMAIL"> [ email @ protected ] </a>
          </p>
        </main>
      </body>
    </html>
    """.replace("ENCODED_EMAIL", encoded)

    result = extract_html_page("https://www.must.ac.ug/contact", html, {})

    assert result.clean_text.count("[email protected]") == 2
    assert "[ email @ protected ]" not in result.clean_text
