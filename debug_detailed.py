import pdfplumber
import os

def check_fees_in_detailed_requirements():
    path = "backend/university_documents/Detailed Entry Requirements 2026-2027.pdf"
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    
    with pdfplumber.open(path) as pdf:
        print(f"Total pages: {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages):
            text = page.extract_text()
            if text and ("500,000" in text or "Functional Fees" in text):
                print(f"\n--- Page {i+1} ---")
                print(text)
                if "500,000" in text:
                    print("!!! Found 500,000 on this page !!!")

if __name__ == "__main__":
    check_fees_in_detailed_requirements()
