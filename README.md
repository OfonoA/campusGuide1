<<<<<<< HEAD
# campusGuide
=======
# CampusGuide Chat Application 🧠💬

CampGuide Chat  App is an AI-powered chatbot web application designed to assist MUST (Mbarara University of Science and Technology) students by providing instant answers to academic and administrative questions. The backend is built using FastAPI, with vector-based retrieval using FAISS and OpenAI's GPT models for natural language responses.

---

## ⚙️ Note

- The virtual environment `venv/` is already included in this project folder for convenience.
- If activation fails or you're on a different system (e.g., Windows), you may need to adjust the activation command as follows:

```bash
# macOS/Linux
source venv/bin/activate

# Windows (CMD)
venv\Scripts\activate.bat

# Windows (PowerShell)
venv\Scripts\Activate.ps1


#If you're on a new system and run into issues, you can delete venv/ and recreate it:

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

#------------------------------------------------------------------------------------------------

# 🚀 How to Run the Backend

### 1. Open the project folder from the terminal/command prompt

cd /path/to/CampG

# Replace /path/to/ with the actual path to the CampG folder on your device.

### 2. Activate the virtual environment

#Depending on your operating system, run:

# macOS/Linux
source venv/bin/activate

# Windows (CMD)
venv\Scripts\activate.bat

# Windows (PowerShell)
venv\Scripts\Activate.ps1

## You'll know it's active when the terminal prompt shows (venv) at the beginning.

### 3. Navigate to the backend directory

cd backend

### 4. Start the FastAPI server using Uvicorn

uvicorn app.main:app --reload

## You should see terminal output similar to:

------------------------------------------------------------------------------

INFO:     Will watch for changes in these directories: ['.../CampG/backend']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [...]
INFO:     Started server process [...]
INFO:     Waiting for application startup.
Startup event triggered: Attempting to load vector store...
Loaded existing FAISS index from faiss_index
Vector store loaded successfully during startup.
INFO:     Application startup complete.

------------------------------------------------------------------------------

#💻 Accessing the Frontend

## Once the backend server is running, open your web browser and go to:


http://127.0.0.1:8000/frontend/login.html


## This will take you to the login page of the CampGuide Chat application. From there, you can log in/ sign up if you don't have an account and start interacting with the chatbot.

## Make sure the backend is running first so that the frontend can communicate with it properly.
>>>>>>> a2131b5 (Initial commit)
