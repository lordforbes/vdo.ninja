# Delite Phone Board (macOS and Windows app)

The station's phone lines as a desktop app. It replaces running `switchboard.html` in a browser.

- **Settings in the app**: SIP server (WebSocket address and domain), each line's extension,
  login name, caller ID name and password, TURN relay, VDO.Ninja site and room, options.
  Passwords are encrypted with the system keychain (macOS Keychain / Windows DPAPI) and handed
  straight to the line pages - never put in a URL or in browser storage.
- **One process per line**: each line runs in its own hidden window, so a busy or crashed line
  can't freeze the others or the board. A crashed line restarts on its own; a line that stops
  answering for 45 s (and isn't on a call) is restarted.
- **Never throttled**, single copy, lives in the tray / menu bar, can start at login.
- **Lines join the room only when a call rings** (default): idle lines stay registered with
  the PBX but outside the room; a ringing call makes its line join (about 1-3 s, the caller hears
  ringing), answer once in, and leave again after the call (the line page reloads and
  re-registers within a few seconds). Untick in Settings to keep lines in the room all the time.
- **Lighter lines by default**: audio only (no guests' video), lines don't connect to each other,
  no echo cancelling / auto-gain / noise reduction on the station feed. Each can be switched back
  on in Settings.
- Board: per line state, caller and timer, caller/return level meters, Answer, Hang up/Decline,
  Output (any audio device, e.g. Loopback or a Focusrite channel), Connect, Line page.
- `phoneboard.log` in the settings folder records start-ups, slow or stuck lines, restarts and,
  once a minute, CPU and memory use per line.

## Install

**Mac (Apple Silicon)**: download `DelitePhoneBoard-x.y.z-mac-arm64.dmg` from the Releases page
(tag `phoneboard-v…`), open it and drag the app to Applications. The app isn't notarised by
Apple, so the first time either right-click it → Open → Open, or run
`xattr -dr com.apple.quarantine "/Applications/Delite Phone Board.app"`. Allow the microphone
when asked (the lines use the station feed as their input).

**Windows**: run `DelitePhoneBoard-Setup-x.y.z.exe` (SmartScreen: More info → Run anyway).

Then open **Settings**, check the SIP server, tick the lines to use and enter their passwords,
and pick each line's **Output** on the board.

Close any other switchboard or line page first (browser tabs, other computers): they would
compete for the same extensions.

## Build

Pushing a tag `phoneboard-vX.Y.Z` runs `.github/workflows/phoneboard.yml`, which builds the
Windows installer, a portable Windows exe and the Mac dmg/zip and attaches them to a release.
Bump `version` in `package.json` to match. Locally: `npm install`, then `npm start`.
