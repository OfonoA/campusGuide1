import pdfplumber
import os

def read_specific_pages(path, start_page, end_page):
    with pdfplumber.open(path) as pdf:
        for i in range(start_page-1, min(end_page, len(pdf.pages))):
            print(f"\n--- Page {i+1} ---")
            print(pdf.pages[i].extract_text())
            tables = pdf.pages[i].extract_tables()
            for j, table in enumerate(tables):
                print(f"\nTable {j+1}:")
                for row in table:
                    print(row)

if __name__ == "__main__":
    read_specific_pages("backend/university_documents/undergradute joining instructions.pdf", 31, 35)
