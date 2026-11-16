// Delite Phone Board 2: the station's phone lines as a desktop app (macOS and Windows).
//
// - Settings live in the app (SIP server, each line's extension and password, TURN, room,
//   outputs). Passwords are encrypted with the operating system's keychain (macOS Keychain /
//   Windows DPAPI) and handed to the line pages directly, never put in a URL.
// - Every phone line runs in its own hidden window, so in its own process: a busy or crashed
//   line can't freeze the others or the board, and a crashed line is reloaded on its own.
// - Nothing is ever throttled, only one copy runs, it lives in the tray / menu bar and can
//   start with the computer.
//
// Settings file: <user data>/config.json (tray menu -> Open settings folder). Log: phoneboard.log.

"use strict";
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, powerSaveBlocker, dialog, ipcMain, safeStorage, systemPreferences } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ---- never throttle: must be set before the app is ready ----
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "IntensiveWakeUpThrottling,CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const APP_NAME = "Delite Phone Board";
const MAX_LINES = 9;
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
		if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) { fs.renameSync(logPath, logPath + ".old"); }
		fs.appendFileSync(logPath, line);
	} catch (e) { /* logging must never stop the board */ }
}

// ---------------------------------------------------------------- settings ----

function defaultLine(n) {
	return { n: n, enabled: n === 1, ext: "880" + n, user: "880" + n, display: "PhoneLine" + n, passwordEnc: "", output: "" };
}
function defaults() {
	const lines = [];
	for (let n = 1; n <= MAX_LINES; n++) { lines.push(defaultLine(n)); }
	return {
		version: 2,
		site: "https://videocall.deliteonline.com/",
		room: "DeliteDialin",
		sip: { wss: "wss://webrtc.d1g1.co.uk:8089/ws", domain: "webrtc.d1g1.co.uk" },
		turn: { url: "turn:webrtc.d1g1.co.uk:3478", user: "vdophone", passwordEnc: "" },
		options: { joinOnRing: true, listen: false, video: false, crosstalk: false, voiceProcessing: false, extra: "" },
		lines: lines,
		startWithWindows: true,
		startMinimized: false
	};
}

function encrypt(plain) {
	if (!plain) { return ""; }
	try {
		if (safeStorage.isEncryptionAvailable()) { return "os:" + safeStorage.encryptString(plain).toString("base64"); }
	} catch (e) { log("encrypt: " + e.message); }
	log("warning: the system keychain is not available; storing a password only obfuscated");
	return "b64:" + Buffer.from(plain, "utf8").toString("base64");
}
function decrypt(enc) {
	if (!enc) { return ""; }
	try {
		if (enc.startsWith("os:")) { return safeStorage.decryptString(Buffer.from(enc.slice(3), "base64")); }
		if (enc.startsWith("b64:")) { return Buffer.from(enc.slice(4), "base64").toString("utf8"); }
	} catch (e) { log("decrypt: " + e.message); }
	return "";
}

function loadConfig() {
	const base = defaults();
	let raw = {};
	try { raw = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (e) { raw = {}; }
	const cfg = Object.assign({}, base, raw);
	cfg.sip = Object.assign({}, base.sip, raw.sip || {});
	cfg.turn = Object.assign({}, base.turn, raw.turn || {});
	cfg.options = Object.assign({}, base.options, raw.options || {});
	cfg.lines = base.lines.map(d => Object.assign({}, d, ((raw.lines || []).find(l => l && l.n === d.n)) || {}));
	if (!raw.version) {
		// 1.x kept only a board address; keep its lines= choice if there was one
		const m = String(raw.url || "").match(/[?&]lines=([0-9,\-]+)/);
		if (m) {
			const want = parseLines(m[1]);
			cfg.lines.forEach(l => { l.enabled = want.indexOf(l.n) !== -1; });
		}
		delete cfg.url;
	}
	cfg.version = 2;
	if (!/\/$/.test(cfg.site)) { cfg.site += "/"; }
	saveConfig(cfg);
	return cfg;
}
function saveConfig(c) {
	try {
		fs.mkdirSync(userDir, { recursive: true });
		fs.writeFileSync(configPath, JSON.stringify(c, null, 2));
	} catch (e) { log("could not save settings: " + e.message); }
}
function parseLines(spec) {
	const out = [];
	String(spec || "").split(",").forEach(part => {
		const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
		if (!m) { return; }
		const a = +m[1], b = m[2] ? +m[2] : a;
		for (let n = Math.min(a, b); n <= Math.max(a, b); n++) { if (n >= 1 && n <= MAX_LINES) { out.push(n); } }
	});
	return out;
}

// what the board's settings screen may see: everything except passwords
function publicSettings() {
	return {
		site: cfg.site, room: cfg.room,
		sip: { wss: cfg.sip.wss, domain: cfg.sip.domain },
		turn: { url: cfg.turn.url, user: cfg.turn.user, hasPassword: !!cfg.turn.passwordEnc },
		options: Object.assign({}, cfg.options),
		lines: cfg.lines.map(l => ({ n: l.n, enabled: l.enabled, ext: l.ext, user: l.user, display: l.display, hasPassword: !!l.passwordEnc, output: l.output })),
		startWithWindows: !!cfg.startWithWindows, startMinimized: !!cfg.startMinimized,
		platform: process.platform, version: app.getVersion()
	};
}

// ---------------------------------------------------------------- state ----

let cfg;
let board = null;
let tray = null;
let quitting = false;
const lines = new Map(); // n -> { win, url, status, levels, latency, applied, loadedAt, slowSince }
let outputs = [];        // [{ id, label }]

function siteOrigin() {
	try { return new URL(cfg.site).origin; } catch (e) { return ""; }
}

function lineUrl(l) {
	const q = new URLSearchParams();
	q.set("room", cfg.room);
	q.set("push", "phoneline" + l.n);
	q.set("label", "Phone Line " + l.n);
	q.set("videodevice", "0");
	q.set("miconly", "");
	if (cfg.options.joinOnRing) {
		q.set("callinjoinonring", ""); // wait outside the room; join when a call rings, leave after
	} else {
		q.set("autostart", "");
	}
	q.set("callin", "sip");
	q.set("sipwss", cfg.sip.wss);
	q.set("sipuri", "sip:" + l.ext + "@" + cfg.sip.domain);
	q.set("sipuser", l.user || l.ext);
	q.set("sipdisplay", l.display || ("PhoneLine" + l.n));
	q.set("sipautoanswer", "");
	q.set("sipauto", "");
	q.set("callinfollowmute", "");
	if (cfg.turn.url) {
		q.set("sipturn", cfg.turn.url);
		if (cfg.turn.user) { q.set("sipturnuser", cfg.turn.user); }
	}
	if (!cfg.options.listen) { q.set("mutespeaker", ""); }
	if (!cfg.options.video) { q.set("novideo", ""); }
	if (!cfg.options.crosstalk) {
		const ids = [];
		for (let n = 1; n <= MAX_LINES; n++) { ids.push("phoneline" + n); }
		q.set("exclude", ids.join(","));
	}
	if (!cfg.options.voiceProcessing) { q.set("aec", "0"); q.set("agc", "0"); q.set("denoise", "0"); }
	let s = q.toString().replace(/=(&|$)/g, "$1");
	const extra = String(cfg.options.extra || "").replace(/^[?&]+/, "");
	if (extra) { s += "&" + extra; }
	return cfg.site + "?" + s;
}

// ---------------------------------------------------------------- permissions ----

function isSiteUrl(u) {
	try { return new URL(u).origin === siteOrigin(); } catch (e) { return false; }
}
function setUpPermissions(ses) {
	// microphone, audio output selection and local-network access (the PBX) for the site only
	ses.setPermissionRequestHandler((wc, permission, callback, details) => {
		const ok = isSiteUrl(details.requestingUrl || wc.getURL());
		if (!ok) { log("refused permission " + permission + " for " + (details.requestingUrl || "")); }
		callback(ok);
	});
	ses.setPermissionCheckHandler((wc, permission, origin) => isSiteUrl(origin));
	ses.setDevicePermissionHandler(details => isSiteUrl(details.origin));
}

// ---------------------------------------------------------------- lines ----

function startLine(l) {
	stopLine(l.n);
	const ses = session.fromPartition("persist:lines");
	const win = new BrowserWindow({
		width: 1200, height: 820, show: false,
		title: "Phone Line " + l.n + " (" + l.ext + ")",
		backgroundColor: "#0f1216",
		icon: path.join(__dirname, "icon.png"),
		autoHideMenuBar: true,
		webPreferences: {
			session: ses,
			preload: path.join(__dirname, "preload-line.js"),
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false
		}
	});
	const rec = { win: win, n: l.n, url: lineUrl(l), status: null, levels: null, latency: 0, applied: null, loadedAt: Date.now(), slowSince: 0, busy: false, gone: false };
	lines.set(l.n, rec);

	win.on("close", e => { if (!quitting && lines.get(l.n) === rec) { e.preventDefault(); win.hide(); } });
	win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
	win.webContents.on("will-navigate", (e, url) => { if (!isSiteUrl(url)) { e.preventDefault(); shell.openExternal(url); } });
	win.webContents.on("render-process-gone", (e, d) => {
		rec.gone = true;
		log("line " + l.n + " page gone: " + d.reason + " (exit " + d.exitCode + "), restarting it in 3 s");
		setTimeout(() => { if (!quitting && lines.get(l.n) === rec) { startLine(cfgLine(l.n)); } }, 3000);
	});
	win.on("unresponsive", () => log("line " + l.n + " unresponsive"));
	win.on("responsive", () => log("line " + l.n + " responsive again"));
	win.webContents.on("did-fail-load", (e, code, desc, url, isMain) => {
		if (!isMain) { return; }
		log("line " + l.n + " load failed (" + code + " " + desc + "), retrying in 10 s");
		setTimeout(() => { if (!quitting && lines.get(l.n) === rec && !win.isDestroyed()) { win.loadURL(rec.url); } }, 10000);
	});
	win.webContents.on("did-finish-load", () => { rec.applied = null; rec.loadedAt = Date.now(); injectLevels(rec); });

	ses.clearCache().catch(() => {}).then(() => {
		if (!win.isDestroyed()) { win.loadURL(rec.url, { extraHeaders: "pragma: no-cache\n" }); }
	});
	log("line " + l.n + " (" + l.ext + ") starting");
}
function stopLine(n) {
	const rec = lines.get(n);
	if (!rec) { return; }
	lines.delete(n);
	try { if (!rec.win.isDestroyed()) { rec.win.destroy(); } } catch (e) {}
}
function cfgLine(n) { return cfg.lines.find(l => l.n === n); }
function startAllLines() {
	cfg.lines.forEach(l => { if (l.enabled) { startLine(l); } else { stopLine(l.n); } });
}

// level meters: analysers on the caller's audio and on what the caller hears, built with the
// line's own audio context so nothing extra has to be unlocked
const LEVELS_JS = `(function () {
	if (window.__pbLevels) { return true; }
	var taps = {};
	function tap(key, stream) {
		var t = taps[key];
		if (t && t.stream === stream) { return t; }
		if (t && t.src) { try { t.src.disconnect(); } catch (e) {} }
		taps[key] = null;
		var ctx = window.session && session.audioCtxOutbound;
		if (!stream || !ctx || !stream.getAudioTracks || !stream.getAudioTracks().length) { return null; }
		try {
			var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
			an.fftSize = 512; src.connect(an);
			taps[key] = { stream: stream, src: src, an: an, buf: new Float32Array(512) };
		} catch (e) { taps[key] = { stream: stream }; }
		return taps[key];
	}
	function level(t) {
		if (!t || !t.an) { return 0; }
		t.an.getFloatTimeDomainData(t.buf);
		var sum = 0;
		for (var i = 0; i < t.buf.length; i++) { sum += t.buf[i] * t.buf[i]; }
		var db = 20 * Math.log10(Math.sqrt(sum / t.buf.length) + 1e-9);
		return Math.max(0, Math.min(1, (db + 60) / 60));
	}
	window.__pbLevels = function () {
		var c = window.session && session.callin;
		return { i: level(tap("in", c && c.remoteStream)), o: level(tap("out", c && c.returnStream)) };
	};
	return true;
})()`;
function injectLevels(rec) {
	if (rec.win.isDestroyed()) { return; }
	rec.win.webContents.executeJavaScript(LEVELS_JS, true).catch(() => {});
}

const STATUS_JS = `(function () {
	try {
		var c = window.session && session.callin;
		var st = c && typeof c.getLineStatus === "function" ? c.getLineStatus() : null;
		var inRoom = !!(window.session && session.videoElement && session.videoElement.id === "videosource");
		return { st: st, inRoom: inRoom };
	} catch (e) { return { err: String(e) }; }
})()`;

function pollLine(rec) {
	if (rec.busy || rec.win.isDestroyed()) { return; }
	rec.busy = true;
	const t0 = Date.now();
	rec.win.webContents.executeJavaScript(STATUS_JS, true).then(r => {
		rec.latency = Date.now() - t0;
		rec.status = r || null;
		applyOutput(rec);
	}).catch(() => { rec.status = null; }).finally(() => {
		rec.busy = false;
		const late = Date.now() - t0;
		if (late > 2500) {
			if (!rec.slowSince) { rec.slowSince = Date.now(); log("line " + rec.n + " slow to respond (" + late + " ms)"); }
		} else if (rec.slowSince && Date.now() - rec.slowSince > 60000) {
			rec.slowSince = 0;
		}
	});
	// a line that hasn't answered at all for 20 s is stuck: note it (the watchdog below restarts it)
	if (rec.busySince && Date.now() - rec.busySince > 20000) { rec.slowSince = rec.slowSince || rec.busySince; }
}

function applyOutput(rec) {
	const l = cfgLine(rec.n);
	const st = rec.status && rec.status.st;
	if (!l || !st) { return; }
	const want = l.output || "";
	if (rec.applied === want) { return; }
	rec.applied = want;
	rec.win.webContents.executeJavaScript("session.callin && session.callin.setOutput && session.callin.setOutput(" + JSON.stringify(want) + ")", true).catch(() => { rec.applied = null; });
}

function pollLevels() {
	lines.forEach(rec => {
		const st = rec.status && rec.status.st;
		if (!st || !(st.inCall || st.ringing) || rec.win.isDestroyed()) { rec.levels = null; return; }
		rec.win.webContents.executeJavaScript("window.__pbLevels ? window.__pbLevels() : null", true)
			.then(v => { rec.levels = v; }).catch(() => {});
	});
}

function refreshOutputs() {
	const rec = Array.from(lines.values()).find(r => r.status && r.status.st);
	if (!rec) { return; }
	rec.win.webContents.executeJavaScript(
		"navigator.mediaDevices.enumerateDevices().then(function (l) { return l.filter(function (d) { return d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications'; }).map(function (d) { return d.label; }).filter(Boolean); })", true)
		.then(list => {
			if (Array.isArray(list) && JSON.stringify(list) !== JSON.stringify(outputs)) { outputs = list; }
		}).catch(() => {});
}

function boardState() {
	return cfg.lines.map(l => {
		const rec = lines.get(l.n);
		const r = rec && rec.status;
		return {
			n: l.n, ext: l.ext, enabled: l.enabled, hasPassword: !!l.passwordEnc, output: l.output,
			running: !!rec, st: r && r.st ? r.st : null, inRoom: !!(r && r.inRoom), err: r && r.err ? r.err : "",
			levels: rec && rec.levels ? rec.levels : null,
			latency: rec ? rec.latency : 0, slow: !!(rec && rec.slowSince), visible: !!(rec && !rec.win.isDestroyed() && rec.win.isVisible())
		};
	});
}

function pushState() {
	if (board && !board.isDestroyed()) {
		board.webContents.send("pb:state", { lines: boardState(), outputs: outputs });
	}
}

// ---------------------------------------------------------------- board window ----

function createBoard() {
	board = new BrowserWindow({
		width: 1300, height: 860, minWidth: 360, minHeight: 300,
		title: APP_NAME,
		backgroundColor: "#0f1216",
		icon: path.join(__dirname, "icon.png"),
		show: !cfg.startMinimized,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload-board.js"),
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false
		}
	});
	board.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
	board.webContents.on("will-navigate", e => e.preventDefault());
	board.webContents.on("render-process-gone", (e, d) => {
		log("board gone: " + d.reason + ", reloading");
		setTimeout(() => { if (board && !board.isDestroyed()) { board.loadFile(path.join(__dirname, "board.html")); } }, 2000);
	});
	board.on("close", e => { if (!quitting) { e.preventDefault(); board.hide(); } });
	board.loadFile(path.join(__dirname, "board.html"));
}

function showBoard() {
	if (!board) { return; }
	if (board.isMinimized()) { board.restore(); }
	board.show();
	board.focus();
}

// ---------------------------------------------------------------- IPC ----

ipcMain.handle("pb:settings", () => publicSettings());

ipcMain.handle("pb:saveSettings", (e, s) => {
	if (!s || typeof s !== "object") { return publicSettings(); }
	const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max || 300);
	cfg.site = str(s.site) || cfg.site;
	if (!/\/$/.test(cfg.site)) { cfg.site += "/"; }
	cfg.room = str(s.room, 80) || cfg.room;
	if (s.sip) { cfg.sip.wss = str(s.sip.wss); cfg.sip.domain = str(s.sip.domain, 120); }
	if (s.turn) {
		cfg.turn.url = str(s.turn.url); cfg.turn.user = str(s.turn.user, 120);
		if (s.turn.clearPassword) { cfg.turn.passwordEnc = ""; }
		else if (s.turn.password) { cfg.turn.passwordEnc = encrypt(String(s.turn.password)); }
	}
	if (s.options) {
		["joinOnRing", "listen", "video", "crosstalk", "voiceProcessing"].forEach(k => { cfg.options[k] = !!s.options[k]; });
		cfg.options.extra = str(s.options.extra, 500);
	}
	if (Array.isArray(s.lines)) {
		s.lines.forEach(nl => {
			const l = cfgLine(+nl.n);
			if (!l) { return; }
			l.enabled = !!nl.enabled;
			l.ext = str(nl.ext, 40) || l.ext;
			l.user = str(nl.user, 80) || l.ext;
			l.display = str(nl.display, 80) || ("PhoneLine" + l.n);
			if (nl.clearPassword) { l.passwordEnc = ""; }
			else if (nl.password) { l.passwordEnc = encrypt(String(nl.password)); }
		});
	}
	if (typeof s.startWithWindows === "boolean") { cfg.startWithWindows = s.startWithWindows; applyLoginItem(); }
	if (typeof s.startMinimized === "boolean") { cfg.startMinimized = s.startMinimized; }
	saveConfig(cfg);
	log("settings saved; restarting lines");
	startAllLines();
	buildTrayMenu();
	return publicSettings();
});

ipcMain.handle("pb:command", (e, n, cmd) => {
	const allowed = { answer: "answerRinging", hangup: "hangup", connect: "toggleConnect" };
	const rec = lines.get(+n);
	if (!rec || !allowed[cmd] || rec.win.isDestroyed()) { return false; }
	return rec.win.webContents.executeJavaScript("(function () { var c = window.session && session.callin; if (c && typeof c." + allowed[cmd] + " === 'function') { c." + allowed[cmd] + "(); return true; } return false; })()", true).catch(() => false);
});

ipcMain.handle("pb:setOutput", (e, n, label) => {
	const l = cfgLine(+n);
	if (!l) { return false; }
	l.output = String(label || "").slice(0, 200);
	saveConfig(cfg);
	const rec = lines.get(+n);
	if (rec) { rec.applied = null; applyOutput(rec); }
	return true;
});

ipcMain.handle("pb:showLine", (e, n, show) => {
	const rec = lines.get(+n);
	if (!rec || rec.win.isDestroyed()) { return false; }
	if (show) { rec.win.show(); rec.win.focus(); } else { rec.win.hide(); }
	return true;
});

ipcMain.handle("pb:restartLine", (e, n) => {
	const l = cfgLine(+n);
	if (l && l.enabled) { startLine(l); return true; }
	return false;
});

ipcMain.handle("pb:openFolder", () => shell.openPath(userDir));

// the line page asks for its secrets synchronously while it starts (see preload-line.js);
// they are only handed over to a page on the configured site
ipcMain.on("pb:lineSecrets", e => {
	let n = 0;
	lines.forEach(rec => { if (!rec.win.isDestroyed() && rec.win.webContents.id === e.sender.id) { n = rec.n; } });
	const l = cfgLine(n);
	const url = e.sender.getURL();
	if (!l || !isSiteUrl(url)) { e.returnValue = null; return; }
	e.returnValue = { sipPassword: decrypt(l.passwordEnc), turnPassword: decrypt(cfg.turn.passwordEnc) };
});

// ---------------------------------------------------------------- tray, menu, startup ----

function applyLoginItem() {
	if (process.platform !== "win32" && process.platform !== "darwin") { return; }
	const opts = { openAtLogin: !!cfg.startWithWindows, args: [] };
	if (process.env.PORTABLE_EXECUTABLE_FILE) { opts.path = process.env.PORTABLE_EXECUTABLE_FILE; }
	try { app.setLoginItemSettings(opts); } catch (e) { log("login item: " + e.message); }
}

async function confirmQuit() {
	const r = await dialog.showMessageBox(board && board.isVisible() ? board : null, {
		type: "warning", buttons: ["Keep running", "Quit"], defaultId: 0, cancelId: 0,
		title: APP_NAME, message: "Quit the phone board?",
		detail: "All phone lines disconnect and calls to the station will not be answered until it is started again."
	});
	if (r.response === 1) { quitting = true; app.quit(); }
}

function buildTrayMenu() {
	if (!tray) { return; }
	tray.setContextMenu(Menu.buildFromTemplate([
		{ label: "Show phone board", click: showBoard },
		{ label: "Restart all lines", click: startAllLines },
		{ type: "separator" },
		{ label: process.platform === "darwin" ? "Start at login" : "Start with Windows", type: "checkbox", checked: !!cfg.startWithWindows,
			click: item => { cfg.startWithWindows = item.checked; saveConfig(cfg); applyLoginItem(); } },
		{ label: "Start hidden", type: "checkbox", checked: !!cfg.startMinimized,
			click: item => { cfg.startMinimized = item.checked; saveConfig(cfg); } },
		{ label: "Open settings folder", click: () => shell.openPath(userDir) },
		{ type: "separator" },
		{ label: "Quit…", click: confirmQuit }
	]));
}

function buildTray() {
	const file = process.platform === "darwin" ? "tray-16.png" : "tray-32.png";
	tray = new Tray(nativeImage.createFromPath(path.join(__dirname, file)));
	tray.setToolTip(APP_NAME);
	buildTrayMenu();
	tray.on("click", showBoard);
}

function buildMenu() {
	const mac = process.platform === "darwin";
	Menu.setApplicationMenu(Menu.buildFromTemplate([].concat(
		mac ? [{ label: APP_NAME, submenu: [{ role: "about" }, { type: "separator" }, { label: "Hide", accelerator: "Cmd+H", click: () => board && board.hide() }, { label: "Quit…", accelerator: "Cmd+Q", click: confirmQuit }] }] : [],
		[{
			label: "Board",
			submenu: [
				{ label: "Restart all lines", accelerator: "CmdOrCtrl+Shift+R", click: startAllLines },
				{ label: "Reload board", accelerator: "CmdOrCtrl+R", click: () => board && board.reload() },
				{ label: "Hide", accelerator: "CmdOrCtrl+W", click: () => board && board.hide() }
			].concat(mac ? [] : [{ type: "separator" }, { label: "Quit…", accelerator: "Ctrl+Q", click: confirmQuit }])
		},
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
				{ type: "separator" }, { role: "togglefullscreen" },
				{ label: "Developer tools", accelerator: "CmdOrCtrl+Alt+I", click: () => board && board.webContents.toggleDevTools() },
				{ label: "Open settings folder", click: () => shell.openPath(userDir) }
			]
		}]
	)));
}

function logUsage() {
	try {
		const m = app.getAppMetrics();
		let cpu = 0, mem = 0;
		const byPid = {};
		m.forEach(p => { cpu += p.cpu ? p.cpu.percentCPUUsage : 0; mem += p.memory ? p.memory.workingSetSize : 0; byPid[p.pid] = p; });
		const per = [];
		lines.forEach(rec => {
			try {
				const p = byPid[rec.win.webContents.getOSProcessId()];
				if (p) { per.push(rec.n + ":" + p.cpu.percentCPUUsage.toFixed(0) + "%"); }
			} catch (e) {}
		});
		log("usage: app cpu " + cpu.toFixed(0) + "% of one core, memory " + Math.round(mem / 1024) + " MB, lines " + (per.join(" ") || "-") +
			", system " + os.cpus().length + " cores, " + Math.round(os.freemem() / 1048576) + " MB free");
	} catch (e) { log("usage: " + e.message); }
}

app.on("second-instance", showBoard);
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* keeps running in the tray */ });
app.on("activate", showBoard);

app.whenReady().then(async () => {
	cfg = loadConfig();
	log("started " + app.getVersion() + " on " + process.platform + " " + os.release());
	if (process.platform === "darwin") {
		try { await systemPreferences.askForMediaAccess("microphone"); } catch (e) { log("mic access: " + e.message); }
	}
	setUpPermissions(session.fromPartition("persist:lines"));
	applyLoginItem();
	powerSaveBlocker.start("prevent-app-suspension");
	buildMenu();
	buildTray();
	createBoard();
	startAllLines();
	setInterval(() => lines.forEach(pollLine), 500);
	setInterval(pollLevels, 150);
	setInterval(pushState, 250);
	setInterval(refreshOutputs, 5000);
	setInterval(logUsage, 60000);
	// watchdog: a line page that has stopped answering for 45 s is restarted on its own
	setInterval(() => {
		lines.forEach(rec => {
			if (rec.busy) {
				rec.busySince = rec.busySince || Date.now();
				if (Date.now() - rec.busySince > 45000 && !(rec.status && rec.status.st && rec.status.st.inCall)) {
					log("line " + rec.n + " stopped answering for 45 s, restarting it");
					rec.busySince = 0;
					startLine(cfgLine(rec.n));
				}
			} else {
				rec.busySince = 0;
			}
		});
	}, 5000);
});
