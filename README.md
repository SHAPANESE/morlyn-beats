# Ramiro Lynn

Single-screen landing page for Ramiro Lynn, offering video editing, 3D animation and motion graphics with a full-page WebGL CRT treatment.

## Run locally

```powershell
python -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

## Controls

- Instagram links to [@morlyn.beats](https://instagram.com/morlyn.beats).

## Credits

- CRT shader structure adapted from [RetroZone](https://github.com/TheMarco/retrozone), used under the MIT License.

See the license files in `vendor/` for third-party code.

## Portfolio

Each service has its own HTML page with a silent TV static transition. The client panel at `admin.html` supports Supabase Free authentication, image uploads, YouTube links, descriptions, drafts and publication to the four galleries. Follow [UPLOAD-SETUP.md](UPLOAD-SETUP.md) to activate it on Vercel; the project connection is configured. Videos use YouTube so they do not consume image Storage. The local server remains available at `http://localhost:4174/cliente` with the original account and files; see [CLIENT_PORTAL.md](CLIENT_PORTAL.md). Run it with `.\.venv\Scripts\python.exe client_server.py serve`. The visual preview on 4173 now uses the configured Supabase project.

Without backend configuration, galleries use `works.json` by channel (01: TV, 02: social media, 03: 3D, 04: motion graphics). Each item accepts type (image or video), src, title, alt and an optional video poster. Store local media under assets/works/.

Selecting a thumbnail or its caption replaces the gallery with the work inside the same CRT channel. Images, video and controls pass through the screen's existing curvature and texture, while the VHS counter keeps running. Videos have play/pause, seeking, sound and fullscreen controls. Return with "Volver a trabajos" or Escape; leaving stops playback and returns focus to the selected work. Empty placeholders show a clearly labeled demo image until real media is added.

YouTube works use their actual thumbnail with a fallback cover. The embedded player keeps native controls and a curved glass outline; its cross-origin video pixels are not rendered through the WebGL CRT shader.
