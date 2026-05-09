import pdfplumber
import os

def check_fees_in_joining_instructions():
    path = "backend/university_documents/undergradute joining instructions.pdf"
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    
    with pdfplumber.open(path) as pdf:
        print(f"Total pages: {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages):
            text = page.extract_text()
            if text and ("Software Engineering" in text or "500,000" in text):
                print(f"\n--- Page {i+1} ---")
                print(text)
                # If we find 500,000, let's look at the surrounding text carefully
                if "500,000" in text:
                    print("!!! Found 500,000 on this page !!!")

if __name__ == "__main__":
    check_fees_in_joining_instructions()
