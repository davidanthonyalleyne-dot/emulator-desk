# Emulator Desk overview

Regenerate: `node shoot.js` (demo-mode screenshots), then `node pdf.js` (prints overview.pdf).
Current copy is also kept in Google Drive > App Overviews as "Emulator Desk Overview - App 2.8 - Doc 2.8.pdf".

The scanner screenshot uses a fake camera: `shoot.js` runs `fixtures/make-label.py` (needs Python with Pillow, and ffmpeg) to build a sample VIN label as `label.y4m`.

Try a 2027-style car that only answers OBD on UDS with `phone.html?demo=uds` (or `index.html?demo=uds`).
