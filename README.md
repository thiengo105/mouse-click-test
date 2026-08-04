# Mouse Click Test

A cross-platform desktop tool for diagnosing mouse hardware faults — worn switches
that double-fire, dropped clicks, stuck buttons, and dirty scroll encoders.

Left panel is the click target with a live mouse diagram. Right panel is
statistics and detected faults.

## Running

```bash
npm install
```

```bash
npm start
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

## Building

Every artifact is **portable** — there is no installer for any platform. Nothing
writes to Program Files, `/Applications`, the registry or a package database.

Requires no cross-compiler: Electron ships prebuilt binaries per architecture,
so every target below is a repack.

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

Output lands in `dist/`.

| Target | Artifact | How it runs |
| --- | --- | --- |
| macOS Intel | `MouseClickTest-1.0.0-mac-x64.zip` | Unzip, double-click the `.app` |
| macOS Apple Silicon | `MouseClickTest-1.0.0-mac-arm64.zip` | Unzip, double-click the `.app` |
| Windows x86_64 | `MouseClickTest-1.0.0-win-x64.exe` | Double-click, no install |
| Windows arm64 | `MouseClickTest-1.0.0-win-arm64.exe` | Double-click, no install |
| Linux | `MouseClickTest-1.0.0-linux-x86_64.AppImage` | `chmod +x`, then run |

You cannot build macOS artifacts from Windows or vice versa, so the full matrix
comes from CI.

### Notes per platform

**macOS** — a `.app` bundle is already self-contained, so the zip is the portable
format; there is no DMG. Run it from anywhere, including a USB stick.

**Windows** — electron-builder's `portable` target is a single self-extracting
exe. `unpackDirName: MouseClickTest` makes it reuse one extraction directory
rather than a fresh temp folder per launch, so startup after the first run is
fast.

**Linux** — AppImage is portable by definition; there was never an install step.
It needs FUSE 2 on the host, which most desktop distros ship. If it refuses to
start, `./MouseClickTest-1.0.0-linux-x86_64.AppImage --appimage-extract-and-run`
bypasses FUSE.

### CI

`.github/workflows/build.yml` builds all five artifacts on every push to `main`
and uploads them as workflow artifacts. Three runners cover the matrix:

- `macos-14` → both macOS architectures
- `windows-latest` → both Windows architectures
- `ubuntu-22.04` → the AppImage (built on an older glibc for wider compatibility)

Pushing a `v*` tag additionally publishes a GitHub Release with all artifacts
attached.

### Code signing

CI builds are **unsigned** — `CSC_IDENTITY_AUTO_DISCOVERY: false` skips it.
Unsigned builds trigger Gatekeeper on macOS and SmartScreen on Windows.

A zip downloaded from a browser carries the quarantine attribute, so macOS will
refuse the first launch. Either right-click → Open, or clear it:

```bash
xattr -dr com.apple.quarantine "Mouse Click Test.app"
```

To sign, remove that env var and add the relevant repository secrets:

- **macOS**: `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, plus `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization.
- **Windows**: `CSC_LINK` and `CSC_KEY_PASSWORD`, or an Azure Trusted Signing
  configuration.

## Layout

```
src/main/main.js        Electron entry: window, navigation lockdown
src/main/preload.js     Exposes platform info over the context bridge
src/renderer/detector.js  Detection engine — pure logic, no DOM
src/renderer/app.js       Event capture and rendering
src/renderer/index.html   Structure
src/renderer/styles.css   Styling
```

`detector.js` holds no DOM references, which is what makes threshold replay and
headless testing possible.
