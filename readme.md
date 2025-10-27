# AFP Assistant Fine-Tuning and RAG

This repository contains the **backend for AFP Assistant**, designed to provide AI-powered guidance on **Polio and Acute Flaccid Paralysis (AFP)** using a **RAG (Retrieval-Augmented Generation)** pipeline. The backend supports multilingual responses (Amharic, Afaan Oromo, English), document-based knowledge retrieval, and integration with an AI model hosted via Vertex AI (Gemini 2.0 or other LLMs).

---

## Features

- **RAG Engine:** Retrieves relevant document chunks from ChromaDB and provides context-aware responses.
- **Fine-Tuned AI:** Uses a custom-trained or API-hosted LLM for domain-specific guidance.
- **Multilingual Support:** Detects language with FastText and responds in Amharic, Afaan Oromo, or English.
- **Document Ingestion:** Supports PDF and Word documents for knowledge base creation.
- **REST API:** Endpoints for querying the assistant and reloading documents.
- **Modular and Extensible:** Easily add new documents, embeddings, and AI models.

---

## Architecture

```

[User Query] --> [FastAPI API] --> [RAG Engine] --> [ChromaDB]
|
v
[Vertex AI / LLM]
|
v
[Generated Response]

````

---

## Tech Stack

- **Backend Framework:** FastAPI
- **LLM Integration:** Vertex AI Gemini 2.0 or API-based LLM  
- **Vector Store:** ChromaDB (persistent client)  
- **Document Parsing:** PyPDF2 (PDF), python-docx (DOCX)  
- **Language Detection:** FastText (`lid.176.bin`) and compact language detector (CLD2)
- **Logging:** Python `logging` module  
- **Document Storage:** Local directory (`./documents`)  
- **Static Assets:** Served from `./static`

---

## Installation

1. Clone the repository:

```bash
git clone https://github.com/Gelane-biru/Polio-RAG.git
cd afp-backend
````

2. Create a virtual environment:

```bash
python -m venv venv
source venv/bin/activate   # Linux/macOS
venv\Scripts\activate      # Windows
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Place your PDF/DOCX documents in the `./documents` directory.

5. Download FastText language detection model (`lid.176.bin`) and place in the root directory.

6. Configure backend (edit `API_URL` if using a custom LLM endpoint).

7. Start the server:

```bash
uvicorn main:app --reload
```

---

## API Endpoints

### 1. Query RAG Assistant

**POST** `/rag_query`

**Request Body:**

```json
{
  "query": "What are the recommended polio vaccination guidelines for children?"
}
```

**Response:**

```json
{
  "query": "...",
  "detected_language": "English",
  "retrieved_documents": ["chunk1", "chunk2", "..."],
  "retrieved_metadatas": [
    {"source": "file.pdf", "chunk_index": 0, "language": "en"},
    ...
  ],
  "response": "Polio vaccination guidelines response..."
}
```

### 2. Reload Documents

**POST** `/reload_docs`

* Clears ChromaDB collection and re-indexes all documents in `./documents`.

**Response:**

```json
{
  "status": "success",
  "documents_indexed": 120
}
```

### 3. Serve UI (Optional)

**GET** `/`

* Serves static assets from the `./static` directory (if a front-end is included).

---

## Document Handling

* **Supported formats:** PDF, DOCX (.docx/.doc)
* **Text Chunking:** Chunks of 500 characters with 25-character overlap
* **Metadata stored:** Source filename, chunk index, detected language
* **Language detection:** FastText (`lid.176.bin`) for Amharic, Afaan Oromo, English

---

## Customization & Fine-Tuning

1. Prepare domain-specific datasets for AFP and Polio.
2. Fine-tune your LLM (Vertex AI Gemini 2.0 or API-hosted model).
3. Update `API_URL` to point to your fine-tuned model endpoint.
4. Reload documents to ensure the knowledge base is fully indexed.
5. Test queries in multiple languages to validate responses.

---

## Logging

* Logs are printed with timestamps and levels (`INFO`, `ERROR`) using Python's logging module.
* Errors during document parsing, language detection, or API requests are logged for debugging.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Contact

**Gelane biru**
Email: [polioafp7@gmail.com](mailto:polioafp7@gmail.com)
