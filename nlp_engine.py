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

LABELS = ["person", "nric number", "mail address", "home address"]

# --- 2. CLEANER ---
def clean_text_minimal(text):
    text = re.sub(r'\[\d+\]', ' ', text)
    text = re.sub(r'\(\d{4}[a-z]?\)', ' ', text)
    text = re.sub(r'(?i)et\s+al\.?', ' ', text)
    text = re.sub(r'(?i)doi\.org/\S+', ' ', text) # Remove DOIs early to stop false flags
    return text

# --- 3. MAIN PROCESS ---
def process_pdf(input_path, output_path):
    log_debug(f"📂 Opening PDF: {input_path}")
    doc = fitz.open(input_path)
    findings = []

    for page_num, page in enumerate(doc):
        log_debug(f"--- Processing Page {page_num + 1} ---")

        # --- A. DETECT "SCANNED" PAGE ---
        # Try getting normal text first
        text_page = page.get_textpage()
        raw_text = text_page.extractText()

        # If text is suspiciously short (e.g. < 50 chars), it's likely an image/scan.
        is_scanned = len(raw_text.strip()) < 50

        if is_scanned:
            log_debug("    📸 Scanned Image Detected! Activating OCR (Tesseract)...")
            try:
                # Create a specialized textpage using OCR
                # dpi=300 ensures we read small text clearly
                text_page = page.get_textpage_ocr(flags=3, full=True, dpi=300)
                raw_text = text_page.extractText()
                log_debug(f"    ✅ OCR extracted {len(raw_text)} characters.")
            except Exception as e:
                log_debug(f"    ❌ OCR Failed (Is Tesseract installed?): {e}")
                continue
        else:
            log_debug("    📄 Standard Text PDF detected.")

        # --- B. REFERENCE CUTTER ---
        if "REFERENCES" in raw_text.upper()[-2000:]:
            # Rough check: if "References" appears, we might want to stop.
            # For scanned docs, strict checking is harder, so we skip complex logic here for now.
            pass

        # --- C. PREPARE TEXT ---
        # Note: 'raw_text' now comes from either the PDF or the OCR Engine
        clean_text = clean_text_minimal(raw_text)

        # --- D. RUN AI ---
        entities = model.predict_entities(clean_text, LABELS, threshold=0.3)
        log_debug(f"    🧠 AI Found {len(entities)} potential entities.")

        # --- E. DRAW BOXES ---
        for ent in entities:
            text_found = ent["text"]
            label_found = ent["label"]
            score = ent["score"]

            # Filter DOI/Http junk if it slipped through
            if "http" in text_found or "doi" in text_found.lower(): continue

            # SEARCH & HIGHLIGHT
            # CRITICAL: We search inside 'text_page' (which might be the OCR layer)
            # This maps the text back to the visual coordinates on the image!
            hits = text_page.search(text_found)

            if hits:
                log_debug(f"      ✅ MATCH: '{text_found}' ({label_found})")
                for rect in hits:
                    annot = page.add_highlight_annot(rect)

                    if "nric" in label_found: annot.set_colors(stroke=(1, 0, 0))
                    elif "address" in label_found: annot.set_colors(stroke=(0, 0, 1))
                    else: annot.set_colors(stroke=(1, 1, 0))

                    annot.update()

                findings.append({
                    "text": text_found,
                    "type": label_found.upper(),
                    "page": page_num + 1,
                    "score": f"{score:.2f}"
                })

    doc.save(output_path)
    return findings

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    try:
        results = process_pdf(sys.argv[1], sys.argv[2])
        print(json.dumps(results))
    except Exception as e:
        log_debug(str(e))
        print(json.dumps([]))