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

# These words trigger a "High Sensitivity" warning
RISK_KEYWORDS = {
    "HIGH": ["STRICTLY CONFIDENTIAL", "TOP SECRET", "NON-DISCLOSURE AGREEMENT", "NDA", "DO NOT DISTRIBUTE"],
    "MEDIUM": ["INTERNAL USE ONLY", "PRIVATE", "DRAFT", "RESTRICTED"],
}

# --- 2. CLEANER ---
def clean_text_minimal(text):
    text = re.sub(r'\[\d+\]', ' ', text)
    text = re.sub(r'\(\d{4}[a-z]?\)', ' ', text)
    text = re.sub(r'(?i)et\s+al\.?', ' ', text)
    text = re.sub(r'(?i)doi\.org/\S+', ' ', text) # Remove DOIs early to stop false flags
    return text

# --- 2. REGEX PATTERNS (The "Hard" Check) ---
REGEX_PATTERNS = {
    # Malaysia NRIC: 12 digits, optional hyphens
    "NRIC_REGEX": r"\b\d{6}-?\d{2}-?\d{4}\b",
    "EMAIL_REGEX": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
    "PHONE_REGEX": r"\b(?:01[0-46-9]-?\d{7,8}|011-?\d{8})\b",

    # Credit Card: 13-19 digits, often grouped
    "CC_REGEX": r"\b(?:\d{4}[-\s]?){3}\d{4}\b",
}

def calculate_risk_score(pii_count, found_keywords):
    # Base Score (Perfectly Safe)
    score = 100
    classification = "PUBLIC"

    # 1. Penalty for PII
    if pii_count > 0:
        score -= (pii_count * 10) # -10 points per PII
        classification = "SENSITIVE"

    # 2. Penalty for Keywords
    for kw in found_keywords:
        if kw in RISK_KEYWORDS["HIGH"]:
            score -= 30
            classification = "RESTRICTED"
        elif kw in RISK_KEYWORDS["MEDIUM"]:
            score -= 15
            if classification != "RESTRICTED": classification = "INTERNAL"

    # Cap the score (0 to 100)
    return max(0, score), classification

def process_pdf(input_path, output_path):
    doc = fitz.open(input_path)
    final_findings = []

    # Track unique findings to prevent duplicates
    found_texts = set()

    for page_num, page in enumerate(doc):
        # 1. Get Text
        text = page.get_text()

        # --- A. REGEX SCANNING (Deterministic) ---
        # We search for patterns BEFORE using AI
        for label, pattern in REGEX_PATTERNS.items():
            matches = re.findall(pattern, text)
            for match in matches:
                if match in found_texts: continue # Skip duplicates

                # Validation: NRIC must be 12 digits (excluding hyphens)
                if "NRIC" in label:
                    digits = re.sub(r'\D', '', match)
                    if len(digits) != 12: continue

                # Highlight & Record
                hit_list = page.search_for(match)
                for rect in hit_list:
                    annot = page.add_redact_annot(rect)
                    annot.update()

                # Add to findings
                final_findings.append({
                    "text": match,
                    "type": label,
                    "page": page_num + 1,
                    "score": 1.0 # Regex is 100% confident
                })

                found_texts.add(match)

        # --- B. AI SCANNING (Contextual) ---
        # Split into chunks for GLiNER
        chunks = [line for line in text.split('\n') if len(line.strip()) > 20]

        for chunk in chunks:
            clean_chunk = clean_text_minimal(chunk)

            # Predict
            entities = model.predict_entities(clean_chunk, LABELS, threshold=0.85) # Higher threshold

            for ent in entities:
                text_found = ent["text"]
                label_found = ent["label"]
                score = ent["score"]

                # 1. Reject if already found by Regex
                if text_found in found_texts: continue

                # 2. Reject Academic Junk (DOI, ISSN, Volume)
                upper_text = text_found.upper()
                if "DOI" in upper_text or "ISSN" in upper_text or "VOL" in upper_text: continue
                if text_found.startswith("10."): continue # DOIs start with 10.

                # 3. Strict NRIC Check
                if label_found == "nric number":
                    # Must have at least 10 numbers
                    digit_count = sum(c.isdigit() for c in text_found)
                    if digit_count < 10: continue
                    # Must NOT have dots (like 10.1108)
                    if "." in text_found: continue

                # 4. Strict Email Check
                if "email" in label_found and "@" not in text_found: continue

                # 5. Strict Phone Check
                if "phone" in label_found:
                    digit_count = sum(c.isdigit() for c in text_found)
                    if digit_count < 9: continue # Too short to be a phone number

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
                    found_texts.add(text_found)

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