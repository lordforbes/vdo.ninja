/*
 * Delite front-page theme (site-specific, not part of upstream VDO.Ninja).
 * Marks the bare front page with html.dl-home so delite-theme.css only restyles it;
 * rooms, the director view, scenes and the switchboard are left untouched.
 */
(function () {
	"use strict";
	var ignore = { lang: 1, ln: 1, l: 1 };
	try {
		var params = new URLSearchParams(window.location.search);
		var keys = [];
		params.forEach(function (v, k) {
			if (!ignore[k.toLowerCase()]) { keys.push(k); }
		});
		if (keys.length || window.location.hash.length > 1) { return; }
	} catch (e) {
		return;
	}
	document.documentElement.classList.add("dl-home");

	// The first cards draw their icons as black-stroked SVG backgrounds; redraw them light.
	function recolorIcons() {
		var rules = [];
		var cards = document.querySelectorAll("#mainmenu > .column[id]");
		for (var i = 0; i < cards.length; i++) {
			var bg = window.getComputedStyle(cards[i]).backgroundImage || "";
			if (bg.indexOf("data:image/svg+xml") === -1 || bg.indexOf("%23000") === -1) { continue; }
			var light = bg.replace(/%23000000|%23000(?![0-9a-fA-F])/g, "%23aab4bf");
			rules.push("html.dl-home #" + cards[i].id + "{background-image:" + light + "}");
		}
		if (!rules.length) { return; }
		var style = document.createElement("style");
		style.id = "dl-icon-colors";
		style.textContent = rules.join("\n");
		document.head.appendChild(style);
	}

	function polishCopy() {
		var input = document.getElementById("joinroomID");
		var go = document.getElementById("jumptoroomButton");
		if (input) {
			input.placeholder = "Room name";
			input.setAttribute("aria-label", "Room name");
		}
		if (go && go.textContent.trim() === "GO") {
			go.textContent = "Join";
		}
		var more = document.getElementById("dropButton");
		if (more) {
			more.removeAttribute("aria-hidden");
			more.setAttribute("role", "button");
			more.setAttribute("tabindex", "0");
			more.setAttribute("aria-label", "More options");
			more.addEventListener("keydown", function (e) {
				if (e.key === "Enter" || e.key === " ") { e.preventDefault(); more.click(); }
			});
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function () { recolorIcons(); polishCopy(); });
	} else {
		recolorIcons();
		polishCopy();
	}
})();
