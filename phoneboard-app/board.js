// Delite Phone Board: board window (cards for each line, settings sheet).
(function () {
	"use strict";
	var pb = window.phoneboard;
	var board = document.getElementById("board");
	var empty = document.getElementById("empty");
	var tpl = document.getElementById("card-tpl");
	var cards = {}; // n -> card
	var outputs = [];
	var outputsSig = "";

	function fmt(ms) {
		var s = Math.floor(ms / 1000);
		return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
	}
	function setText(c, key, el, text) {
		if (c.last[key] !== text) { c.last[key] = text; el.textContent = text; }
	}
	function setChip(c, text, cls) {
		var v = text + "|" + cls;
		if (c.last.chip === v) { return; }
		c.last.chip = v;
		c.chip.textContent = text;
		c.chip.className = "chip" + (cls ? " " + cls : "");
	}
	function setMeter(el, v) {
		var w = "calc(" + (100 - Math.round((v || 0) * 100)) + "% + 2px)";
		if (el.style.width !== w) { el.style.width = w; }
	}

	function makeCard(n) {
		var node = tpl.content.firstElementChild.cloneNode(true);
		var c = {
			n: n, el: node, last: {}, callStart: 0,
			chip: node.querySelector(".chip"), caller: node.querySelector(".caller"), timer: node.querySelector(".timer"),
			ext: node.querySelector(".ext"), status: node.querySelector(".status"), warn: node.querySelector(".warnline"),
			answer: node.querySelector(".answer"), hang: node.querySelector(".hang"), conn: node.querySelector(".conn"),
			openb: node.querySelector(".openb"), outsel: node.querySelector(".outsel"),
			mIn: node.querySelector(".m-in"), mOut: node.querySelector(".m-out")
		};
		node.querySelector(".name").textContent = "Line " + n;
		c.answer.onclick = function () { pb.command(n, "answer"); };
		c.hang.onclick = function () { pb.command(n, "hangup"); };
		c.conn.onclick = function () { pb.command(n, "connect"); };
		c.openb.onclick = function () { pb.showLine(n, !c.visible); };
		c.outsel.onchange = function () { pb.setOutput(n, c.outsel.value); };
		cards[n] = c;
		return c;
	}

	function fillOutputs(c, current) {
		var sig = outputsSig + "|" + current;
		if (c.last.outs === sig || document.activeElement === c.outsel) { return; }
		c.last.outs = sig;
		c.outsel.innerHTML = "";
		var opts = [["", "Off (not played here)"], ["default", "System default output"]].concat(outputs.map(function (l) { return [l, l]; }));
		if (current && current !== "default" && outputs.indexOf(current) === -1) { opts.push([current, current + " (not connected)"]); }
		opts.forEach(function (p) {
			var o = document.createElement("option");
			o.value = p[0]; o.textContent = p[1];
			c.outsel.appendChild(o);
		});
		c.outsel.value = current || "";
	}

	function render(state) {
		outputs = state.outputs || [];
		outputsSig = outputs.join("|");
		var reg = 0, onCall = 0, ringing = 0, shown = 0, ringingAny = false;
		var seen = {};
		(state.lines || []).forEach(function (L) {
			if (!L.enabled) { return; }
			shown++;
			seen[L.n] = true;
			var c = cards[L.n] || makeCard(L.n);
			if (!c.el.parentNode) { board.appendChild(c.el); }
			c.visible = L.visible;
			var st = L.st;
			setText(c, "ext", c.ext, L.ext);
			setText(c, "openb", c.openb, L.visible ? "Hide page" : "Line page");
			fillOutputs(c, L.output);
			c.el.classList.toggle("ringing", !!(st && st.ringing));
			c.el.classList.toggle("oncall", !!(st && st.inCall));
			if (!st) {
				setChip(c, L.running ? "Starting" : "Off", "");
				setText(c, "caller", c.caller, "");
				setText(c, "timer", c.timer, "");
				setText(c, "status", c.status, L.err ? "Page error: " + L.err : "");
				c.answer.disabled = true; c.hang.disabled = true; c.conn.disabled = true;
				c.hang.classList.remove("live");
			} else {
				if (st.registered) { reg++; }
				if (st.inCall) { onCall++; }
				if (st.ringing) { ringing++; ringingAny = true; }
				if (st.inCall) {
					if (!c.callStart) { c.callStart = Date.now(); }
					setChip(c, "On call", "call");
				} else {
					c.callStart = 0;
					if (st.ringing) { setChip(c, "Ringing", "ring"); }
					else if (st.registered) { setChip(c, "Ready", "ok"); }
					else if (st.pending) { setChip(c, "Connecting", "warn"); }
					else if (!st.hasPassword) { setChip(c, "Needs password", "warn"); }
					else { setChip(c, "Offline", "bad"); }
				}
				var live = st.inCall || st.ringing;
				setText(c, "caller", c.caller, st.caller || (live ? "Unknown caller" : (st.registered ? "Waiting for calls" : "")));
				c.caller.classList.toggle("idle", !live);
				setText(c, "timer", c.timer, c.callStart ? fmt(Date.now() - c.callStart) : "");
				setText(c, "status", c.status, st.status || "");
				c.status.title = st.status || "";
				c.answer.disabled = !st.ringing;
				c.hang.disabled = !live;
				c.hang.classList.toggle("live", live);
				setText(c, "hangl", c.hang, st.ringing ? "Decline" : "Hang up");
				c.conn.disabled = !!st.pending;
				setText(c, "conn", c.conn, st.connected ? "Disconnect" : "Connect");
			}
			var warn = "";
			if (!L.hasPassword) { warn = "No password saved for this line: open Settings."; }
			else if (L.slow) { warn = "This line is answering slowly (" + Math.round(L.latency / 100) / 10 + " s): the computer may be overloaded, and calls can fail."; }
			else if (st && !L.inRoom) { warn = "Not in the room yet: calls would be silent. Open the line page if it doesn't join by itself."; }
			setText(c, "warn", c.warn, warn);
			c.warn.hidden = !warn;
			var lv = L.levels || { i: 0, o: 0 };
			setMeter(c.mIn, lv.i);
			setMeter(c.mOut, lv.o);
		});
		Object.keys(cards).forEach(function (n) {
			if (!seen[n] && cards[n].el.parentNode) { cards[n].el.parentNode.removeChild(cards[n].el); }
		});
		empty.style.display = shown ? "none" : "";
		var sum = "<b>" + reg + "</b>/" + shown + " ready &middot; <b>" + onCall + "</b> on call" + (ringing ? " &middot; <b>" + ringing + "</b> ringing" : "");
		var sumEl = document.getElementById("sum");
		if (sumEl.innerHTML !== sum) { sumEl.innerHTML = sum; }
		var title = (ringingAny ? "Ringing - " : "") + (onCall ? "(" + onCall + ") " : "") + "Delite Phone Board";
		if (document.title !== title) { document.title = title; }
	}

	pb.onState(render);

	// ---------------- settings ----------------
	var sheet = document.getElementById("sheet");
	var form = document.getElementById("settings");
	var rows = document.getElementById("lineRows");

	function field(name) { return form.elements.namedItem(name); }

	function openSettings() {
		pb.settings().then(function (s) {
			field("sip.wss").value = s.sip.wss || "";
			field("sip.domain").value = s.sip.domain || "";
			field("site").value = s.site || "";
			field("room").value = s.room || "";
			field("turn.url").value = s.turn.url || "";
			field("turn.user").value = s.turn.user || "";
			field("turn.password").value = "";
			field("turn.password").placeholder = s.turn.hasPassword ? "(saved - leave empty to keep)" : "(none saved)";
			["listen", "video", "crosstalk", "voiceProcessing"].forEach(function (k) { field("options." + k).checked = !!s.options[k]; });
			field("options.extra").value = s.options.extra || "";
			field("startWithWindows").checked = !!s.startWithWindows;
			field("startMinimized").checked = !!s.startMinimized;
			document.getElementById("startLabel").textContent = s.platform === "darwin" ? "Start at login" : "Start with Windows";
			document.getElementById("verNote").textContent = "Version " + s.version;
			document.getElementById("savedNote").textContent = "";
			rows.innerHTML = "";
			s.lines.forEach(function (l) {
				var tr = document.createElement("tr");
				tr.dataset.n = l.n;
				tr.innerHTML =
					'<td class="num">Line ' + l.n + '</td>' +
					'<td><input type="checkbox" data-k="enabled" aria-label="Line ' + l.n + ' on"></td>' +
					'<td><input type="text" data-k="ext" aria-label="Line ' + l.n + ' extension"></td>' +
					'<td><input type="text" data-k="user" aria-label="Line ' + l.n + ' login name"></td>' +
					'<td><input type="text" data-k="display" aria-label="Line ' + l.n + ' caller ID name"></td>' +
					'<td><input type="password" data-k="password" aria-label="Line ' + l.n + ' password"></td>';
				tr.querySelector('[data-k=enabled]').checked = !!l.enabled;
				tr.querySelector('[data-k=ext]').value = l.ext || "";
				tr.querySelector('[data-k=user]').value = l.user || "";
				tr.querySelector('[data-k=display]').value = l.display || "";
				tr.querySelector('[data-k=password]').placeholder = l.hasPassword ? "(saved)" : "(none saved)";
				rows.appendChild(tr);
			});
			sheet.classList.add("open");
			field("sip.wss").focus();
		});
	}
	function closeSettings() { sheet.classList.remove("open"); }

	form.addEventListener("submit", function (e) {
		e.preventDefault();
		var s = {
			site: field("site").value, room: field("room").value,
			sip: { wss: field("sip.wss").value, domain: field("sip.domain").value },
			turn: { url: field("turn.url").value, user: field("turn.user").value, password: field("turn.password").value },
			options: { extra: field("options.extra").value },
			startWithWindows: field("startWithWindows").checked,
			startMinimized: field("startMinimized").checked,
			lines: []
		};
		["listen", "video", "crosstalk", "voiceProcessing"].forEach(function (k) { s.options[k] = field("options." + k).checked; });
		Array.prototype.forEach.call(rows.querySelectorAll("tr"), function (tr) {
			s.lines.push({
				n: +tr.dataset.n,
				enabled: tr.querySelector('[data-k=enabled]').checked,
				ext: tr.querySelector('[data-k=ext]').value,
				user: tr.querySelector('[data-k=user]').value,
				display: tr.querySelector('[data-k=display]').value,
				password: tr.querySelector('[data-k=password]').value
			});
		});
		pb.saveSettings(s).then(function () {
			document.getElementById("savedNote").textContent = "Saved. Lines are restarting.";
			setTimeout(closeSettings, 900);
		});
	});
	document.getElementById("settingsBtn").onclick = openSettings;
	document.getElementById("cancelBtn").onclick = closeSettings;
	document.getElementById("folderBtn").onclick = function () { pb.openFolder(); };
	sheet.addEventListener("click", function (e) { if (e.target === sheet) { closeSettings(); } });
	document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeSettings(); } });

	// first run: nothing configured yet -> open settings
	pb.settings().then(function (s) {
		if (!s.lines.some(function (l) { return l.enabled && l.hasPassword; })) { openSettings(); }
	});
})();
