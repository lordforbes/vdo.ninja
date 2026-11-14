// Delite Phone Board: a dedicated desktop window for the VDO.Ninja phone switchboard.
//
// Why an app instead of a Chrome tab: Chrome slows down or pauses pages that are not on
// screen. A paused switchboard answers the PBX late, Asterisk marks the lines Unavailable and
// calls fail without ringing. This app never throttles the board, runs only one copy, keeps
// running in the tray, can start with Windows and reloads itself if the page crashes.
//
// Settings live in %APPDATA%\Delite Phone Board\config.json (created on first run):
//   url                the switchboard address (any switchboard options can go on the end)
//   startWithWindows   true/false
//   startMinimized     true/false (start in the tray)
// "--url=https://..." on the command line overrides url for that run.

"use strict";
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, powerSaveBlocker, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// ---- never throttle: these must be set before the app is ready ----
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "IntensiveWakeUpThrottling,CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const DEFAULT_URL = "https://videocall.deliteonline.com/switchboard.html";
const APP_NAME = "Delite Phone Board";
app.setName(APP_NAME);
if (process.platform === "win32") { app.setAppUserModelId("com.deliteonline.phoneboard"); }

// ---- one copy only: a second copy would register the same extensions and steal calls ----
if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

const userDir = app.getPath("userData");
const configPath = path.join(userDir, "config.json");
const logPath = path.join(userDir, "phoneboard.log");

function log(msg) {
	const line = new Date().toISOString() + " " + msg + "\n";
	try {
		fs.mkdirSync(userDir, { recursive: true });
		// keep the log small: start again past 1 MB
		if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) { fs.renameSync(logPath, logPath + ".old"); }
		fs.appendFileSync(logPath, line);
	} catch (e) { /* logging must never stop the board */ }
}

function loadConfig() {
	const defaults = { url: DEFAULT_URL, startWithWindows: true, startMinimized: false };
	let cfg = {};
	try { cfg = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (e) { cfg = {}; }
	cfg = Object.assign({}, defaults, cfg);
	try {
		fs.mkdirSync(userDir, { recursive: true });
		fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
	} catch (e) { log("could not write config: " + e.message); }
	const arg = process.argv.find(a => a.startsWith("--url="));
	if (arg) { cfg.url = arg.slice(6); }
	return cfg;
}
function saveConfig(cfg) {
	try { fs.writeFileSync(configPath, JSON.stringify({ url: cfg.url, startWithWindows: cfg.startWithWindows, startMinimized: cfg.startMinimized }, null, 2)); } catch (e) { log("could not save config: " + e.message); }
}

let cfg;
let win = null;
let tray = null;
let quitting = false;
let boardOrigin = "";

function iconPath(name) { return path.join(__dirname, name); }

// Always fetch the current board: the site lets browsers keep pages for 10 minutes, and a stale
// copy would hide fixes until it expires.
function loadBoard() {
	if (!win || win.isDestroyed()) { return; }
	win.webContents.session.clearCache().catch(() => {}).then(() => {
		if (win && !win.isDestroyed()) { win.loadURL(cfg.url, { extraHeaders: "pragma: no-cache\n" }); }
	});
}

// Once a minute, note CPU and memory use in the log, so a struggling PC shows up there.
function logUsage() {
	try {
		const m = app.getAppMetrics();
		let cpu = 0, mem = 0, renderer = 0;
		m.forEach(p => {
			cpu += p.cpu ? p.cpu.percentCPUUsage : 0;
			mem += p.memory ? p.memory.workingSetSize : 0;
			if (p.type === "Tab" || p.type === "Renderer") { renderer = Math.max(renderer, p.cpu ? p.cpu.percentCPUUsage : 0); }
		});
		const os = require("os");
		const load = os.cpus().length;
		log("usage: app cpu " + cpu.toFixed(0) + "% of one core (busiest page " + renderer.toFixed(0) + "%), memory " + Math.round(mem / 1024) + " MB, " + load + " cores, " + Math.round(os.freemem() / 1048576) + " MB free");
	} catch (e) { log("usage: " + e.message); }
}

function applyLoginItem() {
	if (process.platform !== "win32" && process.platform !== "darwin") { return; }
	const opts = { openAtLogin: !!cfg.startWithWindows, args: [] };
	// the portable .exe unpacks itself to a temporary folder each run: start the .exe itself
	if (process.env.PORTABLE_EXECUTABLE_FILE) { opts.path = process.env.PORTABLE_EXECUTABLE_FILE; }
	try { app.setLoginItemSettings(opts); } catch (e) { log("login item: " + e.message); }
}

function isBoardUrl(u) {
	try { return new URL(u).origin === boardOrigin; } catch (e) { return false; }
}

function setUpPermissions(ses) {
	// The board and its lines need the microphone, audio output selection and access to the
	// station's PBX on the local network. Grant those to the board's own site only.
	ses.setPermissionRequestHandler((wc, permission, callback, details) => {
		const ok = isBoardUrl(details.requestingUrl || wc.getURL());
		if (!ok) { log("refused permission " + permission + " for " + (details.requestingUrl || "")); }
		callback(ok);
	});
	ses.setPermissionCheckHandler((wc, permission, origin) => isBoardUrl(origin));
	ses.setDevicePermissionHandler(details => isBoardUrl(details.origin));
}

function createWindow() {
	const ses = session.fromPartition("persist:board"); // keeps saved line passwords and output choices
	setUpPermissions(ses);

	win = new BrowserWindow({
		width: 1400, height: 900, minWidth: 360, minHeight: 300,
		title: APP_NAME,
		backgroundColor: "#0f1216",
		icon: iconPath("icon.png"),
		show: !cfg.startMinimized,
		autoHideMenuBar: true,
		webPreferences: {
			session: ses,
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false
		}
	});

	// keep the window on the board's site; anything else opens in the normal browser
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (!isBoardUrl(url)) { shell.openExternal(url); return { action: "deny" }; }
		return { action: "allow" };
	});
	win.webContents.on("will-navigate", (e, url) => {
		if (!isBoardUrl(url)) { e.preventDefault(); shell.openExternal(url); }
	});

	// self-healing: reload if the page crashes or is killed; note hangs in the log
	win.webContents.on("render-process-gone", (e, details) => {
		log("board page gone: " + details.reason + " (exit " + details.exitCode + "), reloading in 3 s");
		setTimeout(loadBoard, 3000);
	});
	win.on("unresponsive", () => log("board page unresponsive"));
	win.on("responsive", () => log("board page responsive again"));
	win.webContents.on("did-fail-load", (e, code, desc, url, isMain) => {
		if (!isMain) { return; }
		log("load failed (" + code + " " + desc + "), retrying in 10 s");
		setTimeout(loadBoard, 10000);
	});
	win.webContents.on("page-title-updated", (e, title) => {
		if (tray) { tray.setToolTip(title.replace("Phone Switchboard", APP_NAME)); }
	});

	// closing the window keeps the lines running in the tray
	win.on("close", e => {
		if (!quitting) {
			e.preventDefault();
			win.hide();
		}
	});

	loadBoard();
	log("started " + app.getVersion() + ", loading " + cfg.url);
}

function showWindow() {
	if (!win) { return; }
	if (win.isMinimized()) { win.restore(); }
	win.show();
	win.focus();
}

async function confirmQuit() {
	const r = await dialog.showMessageBox(win, {
		type: "warning",
		buttons: ["Keep running", "Quit"],
		defaultId: 0, cancelId: 0,
		title: APP_NAME,
		message: "Quit the phone board?",
		detail: "All phone lines disconnect and calls to the station will not be answered until it is started again."
	});
	if (r.response === 1) {
		quitting = true;
		app.quit();
	}
}

function buildTray() {
	const img = nativeImage.createFromPath(iconPath(process.platform === "win32" ? "tray-32.png" : "tray-16.png"));
	tray = new Tray(img);
	tray.setToolTip(APP_NAME);
	const menu = () => Menu.buildFromTemplate([
		{ label: "Show phone board", click: showWindow },
		{ label: "Reload", click: loadBoard },
		{ type: "separator" },
		{
			label: "Start with Windows", type: "checkbox", checked: !!cfg.startWithWindows,
			click: item => { cfg.startWithWindows = item.checked; saveConfig(cfg); applyLoginItem(); }
		},
		{
			label: "Start in the tray", type: "checkbox", checked: !!cfg.startMinimized,
			click: item => { cfg.startMinimized = item.checked; saveConfig(cfg); }
		},
		{ label: "Open settings folder", click: () => shell.openPath(userDir) },
		{ type: "separator" },
		{ label: "Quit…", click: confirmQuit }
	]);
	tray.setContextMenu(menu());
	tray.on("click", showWindow);
}

function buildMenu() {
	Menu.setApplicationMenu(Menu.buildFromTemplate([
		{
			label: "Board",
			submenu: [
				{ label: "Reload", accelerator: "CmdOrCtrl+R", click: loadBoard },
				{ label: "Hide to tray", accelerator: "CmdOrCtrl+W", click: () => win && win.hide() },
				{ type: "separator" },
				{ label: "Quit…", accelerator: "CmdOrCtrl+Q", click: confirmQuit }
			]
		},
		{
			label: "View",
			submenu: [
				{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
				{ label: "Developer tools", accelerator: "CmdOrCtrl+Shift+I", click: () => win && win.webContents.toggleDevTools() },
				{ label: "Open log folder", click: () => shell.openPath(userDir) }
			]
		}
	]));
}

app.on("second-instance", showWindow);
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* stays in the tray */ });

app.whenReady().then(() => {
	cfg = loadConfig();
	try { boardOrigin = new URL(cfg.url).origin; } catch (e) { boardOrigin = new URL(DEFAULT_URL).origin; cfg.url = DEFAULT_URL; }
	applyLoginItem();
	// keep Windows from suspending the app (it never stops the screen saver or sleep)
	powerSaveBlocker.start("prevent-app-suspension");
	buildMenu();
	buildTray();
	createWindow();
	setInterval(logUsage, 60000);
});
