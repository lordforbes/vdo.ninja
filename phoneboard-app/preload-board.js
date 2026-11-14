// The board window's bridge to the app: line states in, commands and settings out.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("phoneboard", {
	onState: cb => { ipcRenderer.on("pb:state", (e, s) => cb(s)); },
	settings: () => ipcRenderer.invoke("pb:settings"),
	saveSettings: s => ipcRenderer.invoke("pb:saveSettings", s),
	command: (n, cmd) => ipcRenderer.invoke("pb:command", n, cmd),
	setOutput: (n, label) => ipcRenderer.invoke("pb:setOutput", n, label),
	showLine: (n, show) => ipcRenderer.invoke("pb:showLine", n, show),
	restartLine: n => ipcRenderer.invoke("pb:restartLine", n),
	openFolder: () => ipcRenderer.invoke("pb:openFolder")
});
