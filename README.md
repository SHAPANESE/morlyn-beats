# Morlyn Beats

Single-screen landing page for Morlyn Beats, offering video editing, 3D animation and motion graphics with a full-page WebGL CRT treatment.

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

Each service has its own HTML page with a silent TV static transition. The client upload panel is at `admin.html`; follow [UPLOAD-SETUP.md](UPLOAD-SETUP.md) to connect Supabase and authorize the client. Connected galleries load published works directly from Supabase.

Without backend configuration, galleries use `works.json` by channel (01: TV, 02: social media, 03: 3D, 04: motion graphics). Each item accepts type (image or video), src, title, alt and an optional video poster. Store local media under assets/works/.

Selecting a thumbnail or its caption replaces the gallery with the work inside the same CRT channel. Images, video and controls pass through the screen's existing curvature and texture, while the VHS counter keeps running. Videos have play/pause, seeking, sound and fullscreen controls. Return with "Volver a trabajos" or Escape; leaving stops playback and returns focus to the selected work. Empty placeholders show a clearly labeled demo image until real media is added.
