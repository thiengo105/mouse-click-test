# Mouse Click Test

A cross-platform desktop tool for diagnosing mouse hardware faults — worn switches
that double-fire, dropped clicks, stuck buttons, and dirty scroll encoders.

Left panel is the click target with a live mouse diagram. Right panel is
statistics and detected faults.

## Running

```bash
npm install
```

Then, with a Rust toolchain installed:

```bash
npm run dev
```

Run the detector's unit tests with:

```bash
npm test
```

## What it detects

The engine timestamps every press, release and wheel event with
`DOMHighResTimeStamp` (sub-millisecond) and grades the intervals between them.

| Fault | How it is detected | Default threshold |
| --- | --- | --- |
| **Double-click / chatter** | A press landing within the chatter window of the previous release. A worn switch bounces; a human cannot re-press this fast. | ≤ 80 ms |
| **Implausibly short clicks** | A full press+release cycle shorter than a human can produce. | < 15 ms |
| **Unmatched releases** | A release with no matching press — the press was dropped. | any |
| **Stuck button** | A button held past the stuck threshold, reported live without waiting for the release. | > 5 s |
| **Scroll reversals** | A wheel direction flip within the reversal window. The hallmark of a dirty or failing optical encoder. | ≤ 60 ms |
| **Erratic scroll distance** | A wheel delta far past the detent step the app infers from your own hardware. | > 4× step |
| **Empty / partial scroll events** | Wheel events carrying no movement, or a fraction of a detent. Normal on a trackpad, suspicious on a notched wheel. | — |

Severity escalates from *warn* to *fail* once a fault exceeds 5% of that input's
events, or occurs three times.

A deliberate double-click is **not** flagged: at ~140 ms between clicks it lands
well outside the chatter window, and is counted separately as an intentional
double-press.

### Inferred detent step

Rather than assuming a wheel delta of 100 or 120 (it varies by OS, mouse and
driver), the app takes the most frequent delta magnitude in your session as one
detent, then measures spikes and partial steps against that.

## Thresholds and replay

Every threshold is adjustable in the **Detection thresholds** panel. Changing one
replays the entire recorded session against the new value rather than discarding
your samples, so you can tighten the chatter window and immediately see whether
borderline clicks reclassify.

**Export JSON** writes the full summary plus the raw event log, which is what you
want to attach to a warranty claim or an RMA.

## Scope

Events are captured **while the app window is focused**. This needs no
accessibility permissions and no native modules, so behaviour is identical on all
five targets. It does mean the app cannot see clicks made in other applications.

## Why there is no Linux build

macOS and Windows only. That is a deliberate limitation, not an oversight.

The app is built on **Tauri**, which uses the operating system's own webview
rather than bundling a browser — that is what keeps it at a couple of megabytes
instead of a hundred. On macOS that webview is WKWebView, on Windows it is
WebView2, and on Linux it would be WebKitGTK.

WebKitGTK is the problem. `WebEventFactory.cpp` translates GDK mouse buttons
like this:

```cpp
if (eventButton == 1)      button = Left;
else if (eventButton == 2) button = Middle;
else if (eventButton == 3) button = Right;
```

GDK reports side buttons as 8 and 9. They match no branch, so the button stays
`None` and the event never reaches the DOM. On WebKitGTK the back and forward
buttons are **undetectable from JavaScript**, and there is no workaround in page
code. A Linux build would silently fail to test two of the buttons it claims to.

macOS and Windows have no such problem: WKWebView's `buttonFromButtonNumber`
maps button numbers 3 and 4 to `Back` and `Forward`, and WebView2 is Chromium.

| Platform | Webview | Side buttons |
| --- | --- | --- |
| macOS | WKWebView | Yes |
| Windows | WebView2 (Chromium) | Yes |
| Linux | WebKitGTK | **No — not shipped** |

Bundling a browser (Electron, or Tauri with a fixed WebView2) would sidestep
this, at roughly 100 MB per platform. Earlier revisions of this repo did ship a
103 MB Electron AppImage for Linux; the history is in git if it is ever wanted
back.

## Building

Every artifact is **portable** — there is no installer for any platform. Nothing
writes to Program Files, `/Applications`, the registry or a package database.

All targets need a Rust toolchain.

```bash
npm run build:mac
```

```bash
npm run build:win
```

```bash
npm run build:win-arm64
```

Output lands in `dist/`.

Sizes below are the real download sizes as uploaded by CI, not estimates.

| Target | Artifact | Size | How it runs |
| --- | --- | --- | --- |
| macOS universal | `MouseClickTest-1.0.0-mac-universal.zip` | 2.3 MB | Unzip, double-click the `.app` |
| Windows x86_64 | `MouseClickTest-1.0.0-win-x64.exe` | 2.5 MB | Double-click, no install |
| Windows arm64 | `MouseClickTest-1.0.0-win-arm64.exe` | 2.3 MB | Double-click, no install |

CI uploads these with `archive: false`, so the download is the artifact itself.
The default wraps every upload in a second zip, and a zip containing a zip is
rejected by macOS Archive Utility as "an unsupported format".

You cannot build macOS artifacts from Windows or vice versa, so the full matrix
comes from CI.

### Notes per platform

**macOS** — one *universal* binary covers Intel and Apple Silicon in a single
download, which is affordable at this size. A `.app` bundle is already
self-contained, so the zip is the portable format; there is no DMG. Run it from
anywhere, including a USB stick.

**Windows** — built with `--no-bundle`, so the artifact is Tauri's raw exe rather
than an MSI or NSIS package. It needs the **Microsoft Edge WebView2 Runtime**,
which is preinstalled on Windows 11 and on Windows 10 via Edge updates. On a
machine without it the app will not start; Tauri can embed a fixed WebView2
version instead, but that adds back over 100 MB and defeats the point.

### CI

`.github/workflows/build.yml` builds all three artifacts on every push to `main`
and uploads them as workflow artifacts:

- `macos-15` → universal build (both Darwin triples, lipo'd)
- `windows-latest` → x64, plus arm64 cross-compiled from the same runner

Pushing a `v*` tag additionally publishes a GitHub Release with all artifacts
attached.

### Code signing

CI builds are **unsigned**. That trips Gatekeeper on macOS and SmartScreen on
Windows.

A zip downloaded from a browser carries the quarantine attribute, so macOS will
refuse the first launch. Either right-click → Open, or clear it:

```bash
xattr -dr com.apple.quarantine "Mouse Click Test.app"
```

To sign, add the relevant repository secrets:

- **macOS**: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, plus `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`
  for notarization.
- **Windows**: configure `bundle.windows.certificateThumbprint` in
  `tauri.conf.json`, or use Azure Trusted Signing.

## Layout

```
src/renderer/detector.js  Detection engine — pure logic, no DOM, no shell APIs
src/renderer/app.js       Event capture and rendering
src/renderer/index.html   Structure
src/renderer/styles.css   Styling

src-tauri/src/main.rs     Window setup and the window.platform script
src-tauri/tauri.conf.json Tauri config; frontendDist points at src/renderer

tools/detector.test.mjs   Unit tests for the detection engine
tools/make-icon.mjs       Generates build/appicon.png from scratch
tools/package.mjs         Collects Tauri output into dist/ under a stable name
```

`detector.js` holds no DOM references, which is what makes threshold replay and
headless testing possible.

The icon is generated rather than committed as an opaque binary. To change it,
edit `tools/make-icon.mjs` and run `npm run icons`.
