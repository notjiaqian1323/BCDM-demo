import sys
import fitz  # PyMuPDF
import json
import re
import os
from gliner import GLiNER

# --- CONFIGURATION ---
# ⚠️ UPDATE THIS PATH to where you installed Tesseract!
# If you added Tesseract to your Windows PATH, you can set this to None.
# Otherwise, point it exactly to the .exe
# --- CONFIGURATION ---
# 1. Point to the executable
TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# 2. Point to the data folder
if TESSERACT_PATH and os.path.exists(TESSERACT_PATH):
    # Get the installation folder (C:\Program Files\Tesseract-OCR)
    install_folder = os.path.dirname(TESSERACT_PATH)

    # Append 'tessdata' to it (C:\Program Files\Tesseract-OCR\tessdata)
    tessdata_folder = os.path.join(install_folder, 'tessdata')

    # Set the environment variable
    os.environ["TESSDATA_PREFIX"] = tessdata_folder

# --- 0. DEBUG HELPER ---
def log_debug(msg):
    sys.stderr.write(f"[Python DEBUG] {msg}\n")
    sys.stderr.flush()

# --- 1. LOAD GLiNER ---
try:
    log_debug("🧠 Loading GLiNER model...")
    model = GLiNER.from_pretrained("urchade/gliner_medium-v2.1")
    log_debug("✅ GLiNER Model Loaded!")
except Exception as e:
    log_debug(f"❌ Critical Error loading GLiNER: {e}")
    sys.exit(1)

# 🎯 TARGET LABELS (Removed 'person' and 'address' to reduce noise)
LABELS = ["nric number", "passport number", "phone number", "email address", "credit card number"]

# --- 2. CLEANER ---
def clean_text_minimal(text):
    text = re.sub(r'\[\d+\]', ' ', text)
    text = re.sub(r'\(\d{4}[a-z]?\)', ' ', text)
    text = re.sub(r'(?i)et\s+al\.?', ' ', text)
    text = re.sub(r'(?i)doi\.org/\S+', ' ', text) # Remove DOIs early to stop false flags
    return text

# --- 2. REGEX PATTERNS (The "Hard" Check) ---
REGEX_PATTERNS = {
    # Malaysia NRIC: YYMMDD-PB-#### (with or without hyphens)
    "NRIC_REGEX": r"\b\d{6}-?\d{2}-?\d{4}\b",

    # Credit Card: 13-19 digits, often grouped
    "CC_REGEX": r"\b(?:\d{4}[-\s]?){3}\d{4}\b",

    # Email: Standard format
    "EMAIL_REGEX": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",

    # Phone: Malaysia Mobile (+60 or 01)
    "PHONE_REGEX": r"\b(?:01[0-46-9]-?\d{7,8}|011-?\d{8})\b"
}

def process_pdf(input_path, output_path):
    doc = fitz.open(input_path)
    final_findings = []

    for page_num, page in enumerate(doc):
        # 1. Get Text
        text = page.get_text()

        # --- A. REGEX SCANNING (Deterministic) ---
        # We search for patterns BEFORE using AI
        for label, pattern in REGEX_PATTERNS.items():
            matches = re.findall(pattern, text)
            for match in matches:
                # Add to findings
                final_findings.append({
                    "text": match,
                    "type": label,
                    "page": page_num + 1,
                    "score": 1.0 # Regex is 100% confident
                })

                # Highlight immediately
                hit_list = page.search_for(match)
                for rect in hit_list:
                    annot = page.add_redact_annot(rect) # REDACT (Black Box)
                    annot.update()

        # --- B. AI SCANNING (Contextual) ---
        # Split into chunks for GLiNER
        chunks = [line for line in text.split('\n') if len(line.strip()) > 15]

        for chunk in chunks:
            clean_chunk = clean_text_minimal(chunk)

            # Predict
            entities = model.predict_entities(clean_chunk, LABELS, threshold=0.5) # Higher threshold

            for ent in entities:
                text_found = ent["text"]
                label_found = ent["label"]
                score = ent["score"]

                # SKIP LOGIC (Reduce False Positives)
                # 1. If it's just 4 digits (e.g., Year "2022"), ignore it
                if label_found == "nric number" and len(text_found) < 6: continue

                # 2. If score is weak
                if score < 0.60: continue

                # Check if we already found this via Regex (Optimization)
                # (Simple check to avoid double-boxing)
                already_found = any(f['text'] == text_found for f in final_findings)
                if already_found: continue

                # Highlight
                hit_list = page.search_for(text_found)
                if hit_list:
                    for rect in hit_list:
                        # Use Redaction Annotation (Black Box) instead of Highlight
                        annot = page.add_redact_annot(rect)
                        annot.update()

                    final_findings.append({
                        "text": text_found,
                        "type": label_found.upper(),
                        "page": page_num + 1,
                        "score": round(score, 2)
                    })

        # Apply all redactions for this page (Burns the black boxes in)
        page.apply_redactions()

    doc.save(output_path)
    return final_findings

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    try:
        results = process_pdf(sys.argv[1], sys.argv[2])
        print(json.dumps(results))
    except Exception as e:
        log_debug(str(e))
        print(json.dumps([]))