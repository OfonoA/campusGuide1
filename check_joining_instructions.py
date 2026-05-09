import pdfplumber
import os

def read_pdf(path, pages_to_read=10):
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    
    print(f"--- Reading PDF: {path} ---")
    with pdfplumber.open(path) as pdf:
        for i in range(min(pages_to_read, len(pdf.pages))):
            text = pdf.pages[i].extract_text()
            if "Software Engineering" in text or "Functional Fees" in text or "500,000" in text:
                print(f"\n--- Page {i+1} ---")
                print(text)
                tables = pdf.pages[i].extract_tables()
                for j, table in enumerate(tables):
                    print(f"\nTable {j+1}:")
                    for row in table:
                        print(row)

if __name__ == "__main__":
    read_pdf("backend/university_documents/undergradute joining instructions.pdf")
