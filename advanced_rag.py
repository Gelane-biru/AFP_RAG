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
import pycld2 as cld2
import logging
import shutil
import re

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Config
API_URL = "https://polio-chatbot-771299482487.us-central1.run.app/api/generate"
CHROMA_PATH = "chroma_db"
DOCS_DIRECTORY = "./documents"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 25
BATCH_SIZE = 100

# Chroma Init
client = chromadb.PersistentClient(path=CHROMA_PATH)
embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="multi-qa-mpnet-base-dot-v1"
)
collection = client.get_or_create_collection(
    name="documents",
    embedding_function=embedding_function,
    metadata={"hnsw:space": "cosine"}
)

# FastText Init for language detection
fasttext_model = fasttext.load_model("lid.176.bin")
logger.info("Loaded FastText language detection model")

# FastAPI Init
app = FastAPI(title="Polio and AFP Awareness Assistant API")
app.mount("/static", StaticFiles(directory="static"), name="static")

class QueryRequest(BaseModel):
    query: str
    preferred_language: str = None

class QueryResponse(BaseModel):
    query: str
    detected_language: str
    response: str
    retrieved_documents: List[str]
    retrieved_metadatas: List[Dict[str, Any]]

def clean_text(text):
    return re.sub(r'\s+', ' ', text).strip()

def extract_text_from_pdf(file_path):
    try:
        with open(file_path, "rb") as file:
            reader = PyPDF2.PdfReader(file)
            return clean_text("".join([page.extract_text() or "" for page in reader.pages]))
    except Exception as e:
        logger.error(f"PDF error: {str(e)}")
        return ""

def extract_text_from_docx(file_path):
    try:
        doc = Document(file_path)
        return clean_text("\n".join([p.text for p in doc.paragraphs if p.text.strip()]))
    except Exception as e:
        logger.error(f"DOCX error: {str(e)}")
        return ""

def chunk_text(text, chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP):
    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks, current_chunk, current_len = [], [], 0
    for sentence in sentences:
        if current_len + len(sentence) <= chunk_size:
            current_chunk.append(sentence)
            current_len += len(sentence)
        else:
            if current_chunk:
                chunks.append(' '.join(current_chunk))
            current_chunk = [sentence]
            current_len = len(sentence)
    if current_chunk:
        chunks.append(' '.join(current_chunk))
    return chunks

def detect_language(text):
    try:
        prediction = fasttext_model.predict(text.strip().replace('\n', ' ')[:500], k=1)
        lang_code = prediction[0][0].replace('__label__', '')
        logger.info(f"FastText detected: {lang_code}")

        if lang_code == 'om':
            return 'om'
        elif lang_code in ['am', 'en']:
            return lang_code
        else:
            isReliable, textBytesFound, details = cld2.detect(text)
            cld2_lang = details[0][1].lower()
            logger.info(f"CLD2 detected: {cld2_lang}")

            if cld2_lang == 'om':
                return 'om'
            elif cld2_lang in ['am', 'en']:
                return cld2_lang
            else:
                logger.info(f"Unsupported language detected ({cld2_lang}). Defaulting to English.")
                return 'en'
    except Exception as e:
        logger.error(f"Language detection error: {str(e)}")
        return 'en'

def get_language_name(code):
    return {
        'am': 'Amharic',
        'en': 'English',
        'om': 'Afaan Oromo'
    }.get(code, 'English')
    

def load_documents_from_directory(directory):
    docs, metas = [], []
    for filename in os.listdir(directory):
        path = os.path.join(directory, filename)
        text = extract_text_from_pdf(path) if filename.endswith(".pdf") else extract_text_from_docx(path)
        if not text:
            continue
        lang = detect_language(text)
        for i, chunk in enumerate(chunk_text(text)):
            docs.append(chunk)
            metas.append({"source": filename, "chunk_index": i, "language": lang})
    return docs, metas

def index_documents(docs, metas):
    for i in range(0, len(docs), BATCH_SIZE):
        batch = docs[i:i + BATCH_SIZE]
        meta = metas[i:i + BATCH_SIZE]
        ids = [str(uuid.uuid4()) for _ in batch]
        collection.add(documents=batch, ids=ids, metadatas=meta)

def retrieve_documents(query, n_results=7, query_language=None):
    try:
        if query_language:
            results = collection.query(
                query_texts=[query], n_results=n_results,
                where={"language": query_language},
                include=["documents", "metadatas"]
            )
            if results['documents'][0]:
                return results['documents'][0], results['metadatas'][0]
        results = collection.query(
            query_texts=[query], n_results=n_results,
            include=["documents", "metadatas"]
        )
        return results['documents'][0], results['metadatas'][0]
    except Exception as e:
        logger.error(f"Retrieval error: {str(e)}")
        return [], []

def generate_response(query, context_docs, metadatas, detected_lang, preferred_lang=None):
    lang = preferred_lang or detected_lang
    lang_name = get_language_name(lang)
    context = "\n".join([
        f"[{m['source']} ({get_language_name(m.get('language', 'en'))})]: {d}"
        for d, m in zip(context_docs, metadatas)
    ])

    prompt = f"""You are a multilingual Polio/AFP expert assistant that helps users understand key aspects of polio and acute flaccid paralysis (AFP).

Rules:
1. Always respond in {lang_name}.
2. Use the provided context as a reference and your expert knowledge to answer questions in detail.
3. If the question is clearly unrelated to polio or AFP, politely explain that you specialize only in those health topics.

Context:
{context}

Query ({get_language_name(detected_lang)}):
{query}

Only answer in {lang_name}:
"""
    try:
        response = requests.post(API_URL, json={"prompt": prompt})
        if response.status_code == 200:
            data = response.json()
            return clean_text(data.get("response", "No response"))
        else:
            logger.error(f"API error: {response.text}")
            return f"Error generating response in {lang_name}"
    except Exception as e:
        logger.error(f"Generation error: {str(e)}")
        return f"Error generating response in {lang_name}"

@app.post("/rag_query", response_model=QueryResponse)
async def rag_query_endpoint(request: QueryRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    detected_lang = detect_language(query)
    docs, metas = retrieve_documents(query, query_language=request.preferred_language or detected_lang)
    answer = generate_response(query, docs, metas, detected_lang, request.preferred_language)
    return QueryResponse(
        query=query,
        detected_language=get_language_name(detected_lang),
        response=answer,
        retrieved_documents=docs,
        retrieved_metadatas=metas
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
