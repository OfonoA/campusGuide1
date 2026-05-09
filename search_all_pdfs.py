import pdfplumber
import os

def search_pdfs(directory, search_terms):
    results = []
    for filename in os.listdir(directory):
        if filename.lower().endswith(".pdf"):
            path = os.path.join(directory, filename)
            try:
                with pdfplumber.open(path) as pdf:
                    for i, page in enumerate(pdf.pages):
                        text = page.extract_text()
                        if text:
                            if all(term.lower() in text.lower() for term in search_terms):
                                results.append((filename, i+1, text))
            except Exception as e:
                print(f"Error reading {filename}: {e}")
    return results

if __name__ == "__main__":
    terms = ["500,000", "Software Engineering"]
    found = search_pdfs("backend/university_documents", terms)
    for filename, page_num, text in found:
        print(f"\n--- Found in {filename} (Page {page_num}) ---")
        print(text[:1000]) # Print first 1000 chars

    # Also search for just 500,000 to see where it appears in general for functional fees
    print("\n" + "="*80 + "\nSearching for '500,000' and 'Functional Fees'...")
    found2 = search_pdfs("backend/university_documents", ["500,000", "Functional Fees"])
    for filename, page_num, text in found2:
        print(f"\n--- Found in {filename} (Page {page_num}) ---")
        print(text[:1000])
