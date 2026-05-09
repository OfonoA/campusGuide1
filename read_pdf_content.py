import pdfplumber
import os

def read_pdf(path, pages_to_read=5):
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    
    print(f"--- Reading PDF: {path} ---")
    with pdfplumber.open(path) as pdf:
        for i in range(min(pages_to_read, len(pdf.pages))):
            print(f"\n--- Page {i+1} ---")
            text = pdf.pages[i].extract_text()
            print(text)
            tables = pdf.pages[i].extract_tables()
            for j, table in enumerate(tables):
                print(f"\nTable {j+1}:")
                for row in table:
                    print(row)

if __name__ == "__main__":
    # Check the Fees Policy
    read_pdf("backend/university_documents/Mbarara University Fees Policy.pdf")
    
    # Check the 2026 call for applications
    print("\n" + "="*80 + "\n")
    read_pdf("backend/university_documents/call for applications 2026.pdf")
    
    # Check detailed entry requirements
    print("\n" + "="*80 + "\n")
    read_pdf("backend/university_documents/Detailed Entry Requirements 2026-2027.pdf")
