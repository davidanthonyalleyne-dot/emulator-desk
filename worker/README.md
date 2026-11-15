# ke-carimages Worker

Fetches car pictures and 3D models from CarImages for the Kē app and Emulator Desk, so the CarImages key stays off the public site.

- URL: https://ke-carimages.davidanthonyalleyne.workers.dev
- `GET /image?make=&model=&year=&view=&color=&width=` returns a WebP picture
- `GET /model?make=&model=&year=` returns the 3D model (GLB)
- Only requests from https://davidanthonyalleyne-dot.github.io are served. Results are kept in Cloudflare's cache for 30 days.
- The key is the Worker secret `CI_KEY`, set in the Cloudflare dashboard. Deploys from this folder (`npx wrangler deploy`).
