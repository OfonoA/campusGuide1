from dotenv import load_dotenv
import os
from langchain_openai import OpenAIEmbeddings

load_dotenv()

print("KEY:", os.getenv("OPENAI_API_KEY"))

embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

print(embeddings.embed_query("Hello")[:5])