from gliner import GLiNER

print("⏳ Starting manual download of GLiNER model...")
# This forces the download to happen now, with a visible progress bar
model = GLiNER.from_pretrained("urchade/gliner_small-v2.1")
print("✅ Download Complete! You can now restart your server.")