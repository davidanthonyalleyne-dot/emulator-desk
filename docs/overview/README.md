# Emulator Desk overview

Regenerate: `node shoot.js` (demo-mode screenshots), then `node pdf.js` (prints overview.pdf).
Current copy is also kept in Google Drive > App Overviews as "Emulator Desk Overview - App 2.15 - Doc 2.15.pdf".

The scanner screenshot uses a fake camera: `shoot.js` runs `fixtures/make-label.py` (needs Python with Pillow, and ffmpeg) to build a sample VIN label as `label.y4m`.

Pretend cars: `?demo` classic OBD-II, `?demo=uds` a 2027 engine car on SAE J1979-2, `?demo=zev` an EV on SAE J1979-3 (battery charge, module name, codes with failure types).
