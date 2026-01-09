import os
from openai import OpenAI
from dotenv import load_dotenv
from typing import List
from scripts.ingest_documents import retrieve_relevant_context  # adjust if you moved it

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

client = OpenAI(api_key=OPENAI_API_KEY)

def generate_response(query: str, context: List[str], chat_history: List[tuple[str, str]] = None, model: str = "gpt-4o") -> str:
    """Generates a context-aware response using OpenAI's gpt-4o."""
    print(f"generate_response called with query: '{query}'")
    print(f"Context received by generate_response:")
    for i, item in enumerate(context):
        print(f"--- Context Chunk {i+1} ---\n{item}\n--- End Chunk ---")

    prompt = f"""You are CampusGuide, a helpful and knowledgeable assistant trained on university-specific documents. 
Answer the following question based on the provided context. Be concise, clear, and helpful.

The context may contain information presented in a structured format, marked by 'TABLE START' and 'TABLE END'. When you encounter such sections, pay attention to the row and column relationships to understand the data and answer the question accurately.

If the context does not contain a direct answer to the question, please respond with a polite message indicating that the information isn't readily available and suggest general areas where the user might find help.

**When responding:**
- Use numbered steps if there is a process or sequence.
- Bold key actions or important words for emphasis.
- If appropriate, include clickable links in Markdown format.
- Separate each step clearly with a heading or divider.
- End the response with a polite reminder or useful tip.

Here is the previous conversation history (last 3 turns):
"""
    if chat_history:
        for user_input, bot_response in chat_history[-3:]:
            prompt += f"User: {user_input}\nBot: {bot_response}\n"
    else:
        prompt += "No previous conversation history available.\n"

    prompt += f"""

Current Context:
{' '.join(context)}

Current Question: {query}
"""
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating response: {e}")
        return "An error occurred while generating the response."

# 🧠 Simple wrapper to make querying easier
def ask_campusguide(query: str, chat_history: List[tuple[str, str]] = None) -> str:
    """
    Retrieves relevant context and generates a CampusGuide response.
    """
    try:
        context = retrieve_relevant_context(query)
    except Exception as e:
        print(f"Error retrieving context for query '{query}': {e}")
        context = []

    try:
        return generate_response(query, context, chat_history)
    except Exception as e:
        print(f"Error generating LLM response: {e}")
        return ""



