# Delite Phone Board (Windows app)

A dedicated window for the phone switchboard (`switchboard.html`). It runs the same page as
the browser, but:

- **never slows down or pauses the board** when it is minimised, covered or in the tray
  (a paused board answers the PBX late, the lines show as Unavailable and calls fail
  without ringing);
- **runs only one copy** (a second copy would register the same extensions and steal calls);
- **keeps running in the tray** when the window is closed; *Quit…* asks first;
- **starts with Windows** (tray menu → *Start with Windows*);
- **reloads itself** if the page crashes, and retries if the site can't be reached;
- grants microphone, audio output and local-network access to the board's own site only;
- keeps line passwords and output choices in its own profile.

## Install

Download `DelitePhoneBoard-Setup-x.y.z.exe` from the repository's Releases page (tag
`phoneboard-v…`) and run it. Then, the first time only, open each line's **Setup** and enter
its password (tick Remember, Save profile, Connect), and pick each line's **Output**.

Close any other switchboard or line page (Chrome tabs, other PCs) first: they would compete
for the same extensions.

## Settings

`%APPDATA%\Delite Phone Board\config.json` (tray menu → *Open settings folder*):

```json
{
  "url": "https://videocall.deliteonline.com/switchboard.html",
  "startWithWindows": true,
  "startMinimized": false
}
```

Switchboard options go on the end of `url`, e.g. `...switchboard.html?lines=1-4`.
Restart the app after editing. The same folder holds `phoneboard.log` (start-up, crashes,
hangs, reloads).

## Build

Pushing a tag `phoneboard-vX.Y.Z` runs `.github/workflows/phoneboard.yml`, which builds the
installer and a portable `.exe` on Windows and attaches them to a release. Bump `version` in
`package.json` to match. Locally: `npm install` then `npm start` (any OS) or `npm run dist`
(Windows).
