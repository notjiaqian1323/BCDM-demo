import sys
import fitz  # PyMuPDF
import json
import re
import os
from gliner import GLiNER
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# --- CONFIGURATION ---
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if TESSERACT_PATH and os.path.exists(TESSERACT_PATH):
    install_folder = os.path.dirname(TESSERACT_PATH)
    tessdata_folder = os.path.join(install_folder, 'tessdata')
    os.environ["TESSDATA_PREFIX"] = tessdata_folder

def log_debug(msg):
    sys.stderr.write(f"[Python DEBUG] {msg}\n")
    sys.stderr.flush()

def log_progress(msg):
    sys.stderr.write(f"⏳ [PYTHON STATUS] {msg}\n")
    sys.stderr.flush()

# --- 1. LOAD GLiNER (ONCE AT BOOT) ---
try:
    log_debug("🧠 Loading GLiNER Small model into memory...")
    # 🚀 UPGRADE 1: Smaller model = 2x speed with ~98% of the accuracy
    model = GLiNER.from_pretrained("urchade/gliner_small-v2.1")
    log_debug("✅ GLiNER Model Loaded and Ready for API Requests!")
except Exception as e:
    log_debug(f"❌ Critical Error loading GLiNER: {e}")
    sys.exit(1)

LABELS = ["nric number", "passport number", "phone number", "email address", "credit card number"]

RISK_KEYWORDS = {
    "HIGH": ["STRICTLY CONFIDENTIAL", "TOP SECRET", "NON-DISCLOSURE AGREEMENT", "NDA", "DO NOT DISTRIBUTE"],
    "MEDIUM": ["INTERNAL USE ONLY", "PRIVATE", "DRAFT", "RESTRICTED"],
}

REGEX_PATTERNS = {
    "NRIC_REGEX": r"\b\d{6}-?\d{2}-?\d{4}\b",
    "EMAIL_REGEX": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
    "PHONE_REGEX": r"\b(?:01[0-46-9]-?\d{7,8}|011-?\d{8})\b",
    "CC_REGEX": r"\b(?:\d{4}[-\s]?){3}\d{4}\b",
}

def clean_text_minimal(text):
    text = re.sub(r'\[\d+\]', ' ', text)
    text = re.sub(r'\(\d{4}[a-z]?\)', ' ', text)
    text = re.sub(r'(?i)et\s+al\.?', ' ', text)
    text = re.sub(r'(?i)doi\.org/\S+', ' ', text)
    return text

def calculate_risk_score(pii_count, found_keywords):
    score = 100
    classification = "PUBLIC"

    if pii_count > 0:
        score -= (pii_count * 10)
        classification = "SENSITIVE"

    for kw in found_keywords:
        if kw in RISK_KEYWORDS["HIGH"]:
            score -= 30
            classification = "RESTRICTED"
        elif kw in RISK_KEYWORDS["MEDIUM"]:
            score -= 15
            if classification != "RESTRICTED": classification = "INTERNAL"

    return max(0, score), classification

# 🚀 UPGRADE 2: Define the FastAPI Server
app = FastAPI(title="BCDS AI Microservice")

class ScanRequest(BaseModel):
    input_path: str
    output_path: str

@app.post("/scan")
def process_pdf_route(req: ScanRequest):
    log_progress(f"📥 Received API request for: {req.input_path}")

    # 🛡️ Crash Protection
    try:
        doc = fitz.open(req.input_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot open broken document: {str(e)}")

    final_findings = []
    found_texts = set()
    found_keywords_in_doc = set() # To track high-risk words
    total_pages = len(doc)

    for page_num, page in enumerate(doc):
        log_progress(f"Scanning Page {page_num + 1} of {total_pages}...")
        text = page.get_text()

        # --- Keyword Scanning for Risk Score ---
        upper_text = text.upper()
        for level, words in RISK_KEYWORDS.items():
            for word in words:
                # 🛡️ THE FIX: Use word boundaries so "NDA" doesn't flag "STANDARD"
                # re.escape ensures special characters in your keywords don't break the regex
                pattern = r'\b' + re.escape(word) + r'\b'
                if re.search(pattern, upper_text):
                    found_keywords_in_doc.add(word)
                    # 📢 THE AUDIT LOG: Print exactly what was found
                    log_progress(f"🚨 AUDIT ALERT: Found {level} risk keyword: '{word}' on page {page_num + 1}")

        # --- A. REGEX SCANNING (Unchanged) ---
        for label, pattern in REGEX_PATTERNS.items():
            matches = re.findall(pattern, text)
            for match in matches:
                if match in found_texts: continue

                if "NRIC" in label:
                    digits = re.sub(r'\D', '', match)
                    if len(digits) != 12: continue

                hit_list = page.search_for(match)
                for rect in hit_list:
                    page.add_redact_annot(rect).update()

                final_findings.append({
                    "text": match, "type": label, "page": page_num + 1, "score": 1.0
                })
                found_texts.add(match)

        # --- B. AI BATCH SCANNING (The Speed Upgrade) ---
        chunks = [line for line in text.split('\n') if len(line.strip()) > 20]
        clean_chunks = [clean_text_minimal(c) for c in chunks]

        # 🚀 UPGRADE 3: Matrix Batching (15 chunks at a time)
        BATCH_SIZE = 15
        batched_chunks = [clean_chunks[i:i + BATCH_SIZE] for i in range(0, len(clean_chunks), BATCH_SIZE)]

        log_progress(f"Page {page_num + 1}: Running GLiNER AI in {len(batched_chunks)} batches...")

        for batch_index, batch in enumerate(batched_chunks):
            # Process 15 sentences simultaneously!
            batch_results = model.batch_predict_entities(batch, LABELS, threshold=0.85)

            # Extract results for each sentence in the batch
            for entities in batch_results:
                for ent in entities:
                    text_found = ent["text"]
                    label_found = ent["label"]
                    score = ent["score"]

                    if text_found in found_texts: continue

                    upper_text_found = text_found.upper()
                    if "DOI" in upper_text_found or "ISSN" in upper_text_found or "VOL" in upper_text_found: continue
                    if text_found.startswith("10."): continue

                    if label_found == "nric number":
                        if sum(c.isdigit() for c in text_found) < 10 or "." in text_found: continue

                    if "email" in label_found and "@" not in text_found: continue

                    if "phone" in label_found and sum(c.isdigit() for c in text_found) < 9: continue

                    already_found = any(f['text'] == text_found for f in final_findings)
                    if already_found: continue

                    hit_list = page.search_for(text_found)
                    if hit_list:
                        for rect in hit_list:
                            page.add_redact_annot(rect).update()

                        final_findings.append({
                            "text": text_found, "type": label_found.upper(),
                            "page": page_num + 1, "score": round(score, 2)
                        })
                        found_texts.add(text_found)

        page.apply_redactions()

    log_progress("Saving redacted PDF...")
    doc.save(req.output_path)

    # Calculate final metadata
    risk_score, classification = calculate_risk_score(len(final_findings), found_keywords_in_doc)

    # 🚀 UPGRADE 4: Return JSON payload directly to HTTP response
    return {
        "findings": final_findings,
        "meta": {
            "risk_score": risk_score,
            "classification": classification,
            "keywords_found": list(found_keywords_in_doc)
        }
    }

if __name__ == "__main__":
    # Start the server on port 8000
    log_debug("🚀 Starting FastAPI Server...")
    uvicorn.run(app, host="127.0.0.1", port=8000)