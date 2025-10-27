import chromadb
import os
import PyPDF2
import requests
from docx import Document
from chromadb.utils import embedding_functions
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any
import fasttext
import logging
import shutil

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
API_URL = "https://polio-chatbot-771299482487.us-central1.run.app/api/generate"
CHROMA_PATH = "chroma_db"
DOCS_DIRECTORY = "./documents"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 25
BATCH_SIZE = 100

# Initialize ChromaDB
client = chromadb.PersistentClient(path=CHROMA_PATH)
embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="multi-qa-mpnet-base-dot-v1"
)
collection = client.get_or_create_collection(
    name="documents",
    embedding_function=embedding_function
)

# Initialize FastText for language detection
fasttext_model = fasttext.load_model("lid.176.bin")
logger.info("Loaded FastText language detection model (lid.176.bin)")

# FastAPI app
app = FastAPI(title="Polio and AFP Awareness Assistant API")
app.mount("/static", StaticFiles(directory="static"), name="static")

class QueryRequest(BaseModel):
    query: str

class QueryResponse(BaseModel):
    query: str
    detected_language: str
    retrieved_documents: List[str]
    retrieved_metadatas: List[Dict[str, Any]]
    response: str

# ---------------- Document utilities ----------------
def extract_text_from_pdf(file_path):
    try:
        with open(file_path, "rb") as file:
            reader = PyPDF2.PdfReader(file)
            text = "".join([page.extract_text() or "" for page in reader.pages])
            return text.strip()
    except Exception as e:
        logger.error(f"Error reading PDF {file_path}: {e}")
        return ""

def extract_text_from_docx(file_path):
    try:
        doc = Document(file_path)
        return "\n".join([para.text for para in doc.paragraphs if para.text.strip()]).strip()
    except Exception as e:
        logger.error(f"Error reading Word document {file_path}: {e}")
        return ""

def chunk_text(text, chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP):
    chunks, start = [], 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        start += chunk_size - chunk_overlap
    return chunks

def detect_language(text):
    try:
        prediction = fasttext_model.predict(text.strip().replace('\n', ' ')[:500], k=1)
        lang_code = prediction[0][0].replace('__label__', '')
        return lang_code
    except Exception as e:
        logger.error(f"FastText language detection failed: {e}")
        return 'en'

def get_language_name(code):
    return {'am': 'Amharic', 'en': 'English', 'om': 'Afaan Oromo'}.get(code, 'English')

def load_documents_from_directory(directory):
    sample_documents, metadatas = [], []
    for filename in os.listdir(directory):
        file_path = os.path.join(directory, filename)
        text = extract_text_from_pdf(file_path) if filename.lower().endswith(".pdf") \
            else extract_text_from_docx(file_path) if filename.lower().endswith((".docx", ".doc")) \
            else ""
        if text:
            lang = detect_language(text)
            chunks = chunk_text(text)
            for i, chunk in enumerate(chunks):
                sample_documents.append(chunk)
                metadatas.append({"source": filename, "chunk_index": i, "language": lang})
    return sample_documents, metadatas

def index_documents(documents, metadatas):
    for i in range(0, len(documents), BATCH_SIZE):
        batch_docs = documents[i:i + BATCH_SIZE]
        batch_metas = metadatas[i:i + BATCH_SIZE]
        batch_ids = [str(uuid.uuid4()) for _ in batch_docs]
        collection.add(documents=batch_docs, ids=batch_ids, metadatas=batch_metas)

# ---------------- Retrieval & Generation ----------------
def retrieve_documents(query, n_results=7, query_language=None):
    results = collection.query(
        query_texts=[query], n_results=n_results,
        where={"language": query_language} if query_language else {},
        include=["documents", "metadatas"]
    )
    return results['documents'][0], results['metadatas'][0]

def generate_response(query, context_docs, metadatas, detected_lang):
    context = "\n".join([
        f"[{meta['source']} ({get_language_name(meta.get('language', 'en'))}), chunk {meta['chunk_index']}]: {doc}"
        for doc, meta in zip(context_docs, metadatas)
    ])
    
    prompt = f"""
You are Polio and Acute Flaccid Paralysis (AFP) Awareness Assistant.

Your role:
- Detect the language of the user query and respond appropriately in Amharic, Afaan Oromo, or English.
- Answer accurately using the provided context below and your knowledge, but integrate the information naturally rather than copying it verbatim.
- If the question is 100% unrelated to polio or AFP, politely reply: "I'm only able to assist with questions about polio and AFP."

**Context:** 
{context}

**User Query ({get_language_name(detected_lang)}):**
{query}

**Instructions:**
- Identify the language (Amharic, Afaan Oromo, or English) and respond in it.
- Answer naturally, clearly, and concisely.
- If you lack sufficient context to answer, respond: "I don't have enough information to answer this question."

Your response:
"""
    try:
        response = requests.post(API_URL, json={"prompt": prompt})
        if response.status_code == 200:
            data = response.json()
            return data.get("response", "No response from API.")
        else:
            logger.error(f"API error: {response.text}")
            return "Error generating response."
    except Exception as e:
        logger.error(f"Error generating response: {e}")
        return "Sorry, I encountered an error processing your request."

# ---------------- Endpoints ----------------
@app.post("/rag_query", response_model=QueryResponse)
async def rag_query_endpoint(request: QueryRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    detected_lang = detect_language(query)
    retrieved_docs, retrieved_metadatas = retrieve_documents(query, query_language=detected_lang)
    response = generate_response(query, retrieved_docs, retrieved_metadatas, detected_lang)
    return QueryResponse(
        query=query,
        detected_language=get_language_name(detected_lang),
        retrieved_documents=retrieved_docs,
        retrieved_metadatas=retrieved_metadatas,
        response=response
    )

@app.post("/reload_docs")
async def reload_documents():
    try:
        # Clear collection first
        collection.delete(where={})
        logger.info("Cleared old documents from Chroma collection.")

        # Reload and reindex
        docs, metas = load_documents_from_directory(DOCS_DIRECTORY)
        if not docs:
            return {"status": "no documents found"}
        
        index_documents(docs, metas)
        logger.info(f"Reindexed {len(docs)} chunks from {len(set(m['source'] for m in metas))} documents.")
        return {"status": "success", "documents_indexed": len(docs)}
    except Exception as e:
        logger.error(f"Error reloading documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def serve_ui():
    return StaticFiles(directory="static", html=True)

# ---------------- Startup ----------------
logger.info("Initial document indexing...")
docs, metas = load_documents_from_directory(DOCS_DIRECTORY)
if docs:
    index_documents(docs, metas)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
