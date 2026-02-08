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

# --- 3. MAIN PROCESS (FIXED) ---
def process_pdf(input_pdf_path, output_pdf_path):
    log_debug(f"📂 Opening PDF: {input_pdf_path}")
    doc = fitz.open(input_pdf_path)
    final_findings = []

    # Iterate through pages
    for page_num, page in enumerate(doc):
        log_debug(f"--- Processing Page {page_num + 1} ---")

        # 1. Get Text (Standard or OCR)
        # Try standard text first
        text = page.get_text()

        # If text is too short, try OCR (if configured)
        if len(text) < 50:
            log_debug("    📸 Scanned Image Detected! Activating OCR...")
            try:
                # Use a temporary textpage for OCR
                # We need this object to map coordinates later
                ocr_page = page.get_textpage_ocr(flags=3, dpi=300, full=True)
                text = ocr_page.extractText()
            except Exception as e:
                log_debug(f"    ❌ OCR Failed: {e}")
                continue

        # 2. CHUNKING (The Fix)
        # We split the text by newlines to get rough "paragraphs" or lines.
        # This helps GLiNER focus on specific contexts.
        chunks = [line for line in text.split('\n') if len(line.strip()) > 10]

        log_debug(f"    📝 Split page into {len(chunks)} chunks for analysis.")

        # 3. Analyze each chunk
        for chunk in chunks:
            # Clean slightly
            chunk_clean = clean_text_minimal(chunk)

            # Predict
            entities = model.predict_entities(chunk_clean, LABELS, threshold=0.3)

            for ent in entities:
                text_found = ent["text"]
                label_found = ent["label"]
                score = ent["score"]

                # Filter bad results
                if len(text_found) < 3: continue # Skip noise like "Mr"
                if score < 0.35: continue # Skip weak matches

                log_debug(f"      ✅ MATCH: '{text_found}' ({label_found}) - {score:.2f}")

                # 4. HIGHLIGHT (The tricky part)
                # We search for the *exact text* on the *entire page*
                # hit_list returns a list of Rect objects (boxes)
                hit_list = page.search_for(text_found)

                if hit_list:
                    for rect in hit_list:
                        # Draw the highlight
                        annot = page.add_highlight_annot(rect)

                        # Color coding
                        if "nric" in label_found: annot.set_colors(stroke=(1, 0, 0)) # Red
                        elif "address" in label_found: annot.set_colors(stroke=(0, 0, 1)) # Blue
                        else: annot.set_colors(stroke=(1, 1, 0)) # Yellow

                        annot.update()

                    # Add to report
                    final_findings.append({
                        "text": text_found,
                        "type": label_found.upper(),
                        "page": page_num + 1,
                        "score": round(score, 2)
                    })

    # Save the modified PDF
    doc.save(output_pdf_path)
    log_debug(f"💾 Saved annotated PDF to {output_pdf_path}")

    return final_findings

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(1)
    try:
        results = process_pdf(sys.argv[1], sys.argv[2])
        print(json.dumps(results))
    except Exception as e:
        log_debug(str(e))
        print(json.dumps([]))