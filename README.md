# PESU Academy Downloader

A browser extension for **[pesuacademy.com](https://www.pesuacademy.com)**. It downloads your course material unit by unit and converts PPT/PPTX/DOC/DOCX (and other formats) to PDF. It then merges everything into clean, bookmarked PDFs and exports the MCQs with their answers.

Made by **Vismay H S**.

It works in **Chrome, Brave, Edge, Chromium, Vivaldi and Arc** on **Windows, macOS and Linux**. It only runs on pesuacademy.com and touches no other site.

---

## Quick start (about 5 minutes)

### 1. Get the code

```bash
git clone https://github.com/VismayHS/Pesu_Merger.git
```

You can also use **Code → Download ZIP** on GitHub and unzip it. Keep the folder somewhere permanent, such as Documents rather than Downloads: the browser loads the extension from this folder.

### 2. Load the extension (all OSes)

1. Open your browser's extensions page:
   - `chrome://extensions`
   - `brave://extensions`
   - `edge://extensions`
2. Turn on **Developer mode** (a toggle in the top-right; in Edge it's in the left sidebar).
3. Click **Load unpacked** and select the **`extension`** folder inside the project. Select that folder itself, not the project root.
4. Pin the extension with the puzzle-piece icon, so it's one click away.

The extension ID is always `cooigkfjkkbolfcfcdmbmdjpmbmlofab`, because a fixed key in `manifest.json` sets it. The converter helper relies on that.

### 3. Install the converter helper (needed only for PPT/DOC → PDF)

PDF material downloads and merges without this step. The helper is a small local program that converts Office files to PDF. It runs only on your machine and needs no admin rights.

| OS | Requirements | Run |
|---|---|---|
| **Windows** | [Python 3](https://www.python.org/downloads/), with "Add to PATH" ticked during setup, plus **MS Office** (best) or **[LibreOffice](https://www.libreoffice.org/download/)** (free) | Double-click `native-host\install.bat` |
| **macOS** | Python 3 (`brew install python`) and LibreOffice (`brew install --cask libreoffice`) | `bash native-host/install.sh` |
| **Linux** | `python3` and LibreOffice (`sudo apt install python3 libreoffice`) | `bash native-host/install.sh` |

The installer:

- finds Python and registers the helper for every supported browser it finds;
- runs a self-test and tells you which converters it found.

After it finishes, press **Re-check** on the extension page, or restart the browser once. The top-right pill should read **Converter: MS Office** or **LibreOffice**.

> Moved the folder? Run the installer again. To remove the helper, run `native-host\uninstall.bat` on Windows or `bash native-host/uninstall.sh` on macOS/Linux.

### 4. Use it

1. Log in to pesuacademy.com in the same browser.
2. Click the extension icon, or the **⬇ PESU Downloader** button on PESU pages.
3. **Pick courses:** choose a semester, tick courses and press **Scan courses**.
4. **Choose content:**
   - toggle categories: Slides, Notes, Assignments, Question Bank, Question Answers, FAQs, MCQs, References;
   - untick units you don't need.
5. **Shape the output:** pick how files are combined. The **What you'll get** panel shows the exact folders and file names before you start.
6. Press **Start**. Leave the tab open until it finishes, then press **Open folder**.

---

## Features

- **Any file mix.** PDF, PPTX, PPT, DOCX, DOC, XLSX, ODP/ODT, RTF, images and text all end up as PDF.
- **Merge styles:**
  - per unit and category (`Unit 1 - Slides.pdf`)
  - per category (`Slides - Units 1-4.pdf`)
  - per unit
  - one PDF for everything
  - no merging
- **Merged PDFs** start with a cover page:
  - what it contains and where it came from;
  - a clickable list of every topic with page numbers;
  - nested bookmarks (Unit → Category → Class).
- **MCQs** are exported with the correct answers, images and equations, as:
  - PDF (answers marked, as a key at the end, or hidden)
  - an interactive practice page (`.html`)
  - Markdown and JSON
- **Pick a naming style.** Under **File names**, choose how course folders, merged PDFs and separate files are named. Each option shows the real name you'll get. Folders are organised automatically.
- **No duplicates.**
  - Material shared across a whole unit is downloaded once.
  - Identical files uploaded under different classes are detected by content (SHA-256) and kept once.
- **Activity tab** with the full log, a problems filter, search, and copy / save.
- **Keeps going on its own:**
  - **Session expired, logged out, or logged in elsewhere?** The run pauses with a banner. Log in again in any PESU tab and it **resumes automatically**, with no restart.
  - **PESU tab closed?** A background PESU tab is reopened when needed.
  - **Internet dropped?** It waits until you're back online, then continues.
  - **Server busy (5xx/429)?** It retries with backoff, using three download routes: direct, through the PESU tab, then the browser's own downloader.
  - **Encrypted or damaged PDFs** are repaired before merging.
  - Anything that still fails is saved on its own and listed in `_Report.txt`.

Output (default names):

```
Downloads/PESU Academy/
  UE24AM342AA5 - ML System Design and AgentOps/
    Unit 1 - Slides.pdf
    Unit 1 - Notes.pdf
    Unit 1 - Question Bank.pdf
    MCQs/Unit 1 - MCQs.pdf | .html | .md
    Files/Unit 1 - .../Slides/01 - Introduction ....pdf   (only if "keep every file separately" is on)
    _Report.txt
```

## Privacy and permissions

Everything runs locally in your browser. The extension talks only to `pesuacademy.com` and its file server `files.pesuacademy.com`, using your existing login. Nothing is sent anywhere else.

| Permission | Why |
|---|---|
| `pesuacademy.com`, `files.pesuacademy.com` | Read course pages and download files with your login |
| `downloads`, `downloads.ui` | Save files into Downloads (the download bubble is hidden during a run) |
| `scripting`, `webRequest` | Fallback route: fetch through your open PESU tab when direct requests are blocked |
| `nativeMessaging` | Talk to the optional local converter helper |
| `storage`, `unlimitedStorage` | Remember your settings, and handle large files in memory |

## Troubleshooting

- **"Converter not installed"**
  - Run the installer for your OS (step 3), then press **Re-check**. If the browser was already open, restart it once.
  - On Linux, a **Snap or Flatpak** browser can't start local helpers. Use the `.deb`/`.rpm` build of Chrome or Brave instead.
- **"Not logged in"**: log in at pesuacademy.com in the same browser profile. The page notices by itself.
- **A PPT failed with Office**: the helper retries with LibreOffice automatically. The original file is kept if both fail.
- **Windows: "Python was not found"**: install Python from python.org; the Microsoft Store stub doesn't work. Then run `install.bat` again.
- **macOS: LibreOffice is installed but not detected**: it must be at `/Applications/LibreOffice.app`. Run `install.sh` again.
- **Helper log:**
  - Windows: `%LOCALAPPDATA%\PESUDownloader\host.log`
  - macOS: `~/Library/Application Support/PESUDownloader/host.log`
  - Linux: `~/.cache/pesu-downloader/host.log`

## Project layout

| Path | Role |
|---|---|
| `extension/app.html`, `app.css`, `app.js` | The downloader page: UI, naming, preview, the job pipeline, dedupe and the session watchdog |
| `extension/src/pesu.js` | Portal endpoints and HTML parsers: semesters, courses, units, class table, content lists, MCQs |
| `extension/src/net.js` | Page and file fetching, with session detection, retries and fallback routes |
| `extension/src/pdf.js` | Merging with pdf-lib: cover and contents page, bookmarks, image/text → PDF, MCQ PDF layout |
| `extension/src/mcq.js` | MCQ HTML → PDF layout (equations rasterised), HTML/Markdown/JSON exports |
| `extension/src/native.js` | Chunked native-messaging client for the helper |
| `native-host/pesu_host.py` | Helper, Python standard library only: MS Office COM (Windows), LibreOffice (all OSes), PDF repair |
| `native-host/install.*` / `uninstall.*` | Per-user registration (Windows registry, or macOS/Linux manifest folders) |

## Development and tests

```bash
# Helper protocol test (run the installer first). Converts every office file in a folder.
node tests/host_test.js <folder with office files>

# PDF engine test (merge, cover page, MCQ layout)
npm install --no-save pdf-lib@1.17.1 @pdf-lib/fontkit@1.1.1
node tests/pdf_test.js <folder with PDFs + tiny.png> <out folder>
```

After editing files under `extension/`, press **Reload** on the extension card.

## Credits

Built by **Vismay H S**.

Third-party code bundled in `extension/lib` and `extension/fonts`:

- [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT)
- [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) (MIT)
- DejaVu fonts (free license, see `extension/fonts/LICENSE-DejaVu.txt`)

This is an unofficial student tool, not affiliated with PES University. Use it only for material you have access to.
