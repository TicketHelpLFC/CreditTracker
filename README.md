# TicketHelpLFC Credit Tracker (PWA)

This is a **static** PWA (HTML/CSS/JS) that runs entirely in the browser and stores data on-device (localStorage).

## Deploy on GitHub Pages (free)

### Option A: Project site (recommended)
1. Create a GitHub repo (e.g. `credit-tracker`)
2. Upload the contents of this folder to the repo root
3. Go to **Settings → Pages**
4. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
5. Save. Your site will be available at:
   - `https://<username>.github.io/<repo>/`

### Option B: User site
Use a repo named `<username>.github.io` and put these files in the root.
The site will be:
- `https://<username>.github.io/`

## Install as an app
- **Android**: open the URL in Chrome → menu → **Add to Home screen**
- **iPhone**: open the URL in Safari → Share → **Add to Home Screen**

## Updating
When you push changes, GitHub Pages redeploys automatically.
If you previously installed the app, remove and reinstall after major updates.

## Notes
- Fixtures are embedded directly into `index.html` (no network fetch required).
