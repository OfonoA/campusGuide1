import os
import sys
from dotenv import load_dotenv

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.retrieval import retrieve_relevant_context_scored
from app.vector_store import vector_store_manager

load_dotenv()

def diagnose_query(query):
    print(f"--- Diagnosing Query: {query} ---")
    results = retrieve_relevant_context_scored(query, top_k=5)
    
    for i, (chunk, score, metadata) in enumerate(results, start=1):
        print(f"\n[Result {i}] Score: {score}")
        print(f"Source: {metadata.get('source')}")
        print(f"Content Preview:\n{chunk}")
        print("-" * 40)

if __name__ == "__main__":
    query = "how much does the Bachelor of Science in Software Engineering cost?"
    diagnose_query(query)
