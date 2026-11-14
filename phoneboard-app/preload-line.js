// Runs in each phone line's window before the page. Hands the line's SIP and TURN passwords
// to callin.js (as window.delitePhoneBoard) without ever putting them in a URL or in storage.
// The main process only answers for pages on the configured site.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
let secrets = null;
try { secrets = ipcRenderer.sendSync("pb:lineSecrets"); } catch (e) { secrets = null; }
if (secrets) {
	contextBridge.exposeInMainWorld("delitePhoneBoard", {
		sipPassword: String(secrets.sipPassword || ""),
		turnPassword: String(secrets.turnPassword || ""),
		app: true
	});
}
