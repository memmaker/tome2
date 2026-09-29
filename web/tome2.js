/*
 * ToME in the browser: terminal rendering, input and save persistence.
 * The game (tome2-core.js / .wasm) calls into Module.qb (see main-web.c).
 */
(function () {
	'use strict';

	var TILE = 16;                 /* source tile size in 16x16.png */
	/* lib/user holds everything the game writes: 2.3/save (ToME module),
	 * 2.3/save/theme (Theme module), notes, scores and the web layout */
	var PERSIST = ['/tome2/lib/user'];
	var SAVE_DIRS = ['/tome2/lib/user/2.3/save/', '/tome2/lib/user/2.3/save/theme/'];

	/* Term 0 main; the rest as in lib/pref/user-x11.prf */
	var TERMS = [
		{ id: 'main', title: '' },
		{ id: 'inv', title: 'Inventory' },
		{ id: 'msg', title: 'Messages' },
		{ id: 'mon', title: 'Visible' },
		{ id: 'rec', title: 'Recall' },
		{ id: 'eqp', title: 'Equipment' }
	];

	var palette = [];
	var terms = [];
	var events = [];
	var tiles = new Image();
	var tilesReady = false;
	var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

	function $(id) { return document.getElementById(id); }

	var row0 = [];   /* the main term's message row (row 0), for RvipWM.prompt */
	var app = RvipApp({
		name: 'tome2',
		save: function () { return saveFilePath() || null; },
		clear: function () { removeSaves(); },
		put: function (file, data) {
			var bytes = data;
			var dir = SAVE_DIRS[isThemeSave(bytes) ? 1 : 0];
			Module.FS.mkdirTree(dir);
			Module.FS.writeFile(dir + SAVE_NAME, bytes);
		},
		exportName: function (p) { return 'tome2-' + (p.indexOf('/theme/') >= 0 ? 'theme-' : '') + p.split('/').pop() + '.sav'; },
		flush: function (done) { Module._web_request_save(); setTimeout(done, 1500); }
	});
	var status = app.status;

	/* ---------- tiling window layout ---------- */

	/*
	 * The windows tile the area below the top bar like a tiling window
	 * manager: a fixed tree of splits, stored as fractions so it adapts to
	 * the browser size.  Windows never overlap and always cover the area:
	 *
	 *   +------------------+-------+   side   : x of main | side column
	 *   |                  |  inv  |   inv    : y of inv | mon (of top height)
	 *   |       main       +-------+   bottom : y of top | bottom row
	 *   |                  |  mon  |   msg    : x of msg | rec
	 *   |                  |       |
	 *   +-------------+----+-------+
	 *   |     msg     |    rec     |
	 *   +-------------+------------+
	 *
	 * The gutters between windows are drag handles.  Split positions, zoom
	 * levels and window titles are kept in LAYOUT_FILE, in the IndexedDB
	 * backed game filesystem next to the savefile.
	 */
	var FONT = '"DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", monospace';
	var GUT = 6, TITLE_H = 20, BORDER = 2;
	var MIN_W = 90, MIN_H = 64, MAIN_MIN_W = 240, MAIN_MIN_H = 160;
	var TILE_STEPS = [16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64];
	var LAYOUT_FILE = '/tome2/lib/user/web-layout.json';
	var SPLITS = ['side', 'bottom', 'inv', 'msg'];

	var L = null;             /* persisted layout state */
	var rects = {};           /* current window rectangles, by id */

	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

	/* Font face per window: the map (text mode) has its own choice */
	function face(i) { var n = L && (i ? L.face : L.mapFace); return n ? '"' + n + '", ' + FONT : FONT; }
	function measure(fontPx, i) {
		var c = document.createElement('canvas').getContext('2d');
		c.font = fontPx + 'px ' + face(i);
		return c.measureText('M').width;
	}

	function areaSize() {
		var g = $('game');
		return { w: g.clientWidth, h: g.clientHeight };
	}

	function defaultLayout() {
		var A = areaSize(), W = A.w, H = A.h;
		/* Not laid out yet (hidden or zero-sized): assume a typical screen */
		if (W < 400 || H < 300) { W = 1280; H = 720; }
		var sideW = clamp(W * 0.24, 260, 440), botH = clamp(H * 0.19, 120, 220);
		var fit = Math.min((W - sideW - GUT - BORDER) / 40, (H - botH - GUT - BORDER) / 24);
		var tile = TILE_STEPS[0];
		TILE_STEPS.forEach(function (t) { if (t <= fit) tile = t; });
		/* auto*: still following the window size (not customised yet) */
		return { v: 1, tile: tile, titles: {}, autoSplit: true, autoTile: true,
			split: { side: (W - sideW) / W, bottom: (H - botH) / H, inv: 0.46, msg: 0.6 } };
	}

	function loadLayout() {
		var d = defaultLayout();
		try {
			var s = JSON.parse(Module.FS.readFile(LAYOUT_FILE, { encoding: 'utf8' }));
			if (s && s.v === 1) {
				SPLITS.forEach(function (k) {
					if (typeof s.split[k] === 'number' && s.split[k] > 0 && s.split[k] < 1) d.split[k] = s.split[k];
				});
				if (TILE_STEPS.indexOf(s.tile) >= 0) d.tile = s.tile;
				d.autoSplit = s.autoSplit === true;
				d.autoTile = s.autoTile === true;
				if (d.autoSplit || d.autoTile) followWindow(d);
				if (s.audio) d.audio = { sound: s.audio.sound === true, music: s.audio.music === true };
				if (s.wm) d.wm = s.wm;
				if (s.font && d.wm && !d.wm.fs) d.wm.fs = s.font;   /* old layout: its text sizes go to the WM once */
				if (s.text === true) d.text = true;
				if (typeof s.face === 'string') d.face = s.face;
				if (typeof s.mapFace === 'string') d.mapFace = s.mapFace;
				if (s.titles) Object.keys(s.titles).forEach(function (k) {
					if (typeof s.titles[k] === 'string' && k !== 'main' && TERMS.some(function (t) { return t.id === k; })) d.titles[k] = s.titles[k].slice(0, 60);
				});
			}
		} catch (err) { /* no layout saved yet */ }
		L = d;
		if (L.audio) { audio.sound = !!L.audio.sound; audio.music = !!L.audio.music; renderAudio(); }
		renderTiles();
		loadFace(L.face); loadFace(L.mapFace);
	}

	var saveTimer = 0;
	function saveLayout() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(function () {
			try {
				Module.FS.writeFile(LAYOUT_FILE, JSON.stringify(L));
				app.sync();
			} catch (err) { console.warn('layout not saved', err); }
		}, 400);
	}

	/*
	 * Until the player drags a gutter / zooms, the splits / tile size are
	 * recomputed for the current window size.  Otherwise a page that first
	 * loads in a tiny window (background tab, pane still opening) would
	 * keep that layout's proportions forever.
	 */
	function followWindow(l) {
		if (!l.autoSplit && !l.autoTile) return;
		var d = defaultLayout();
		if (l.autoSplit) l.split = d.split;
		if (l.autoTile) l.tile = d.tile;
	}

	function place(el, r) {
		el.style.left = r[0] + 'px';
		el.style.top = r[1] + 'px';
		el.style.width = Math.max(0, r[2]) + 'px';
		el.style.height = Math.max(0, r[3]) + 'px';
	}

	/* Windows are placed by the shared tiling window manager (rvip-wm.js) */
	function zooms() {
		var z = { main: function (size, d) { zoomMain(d); } };
		TERMS.forEach(function (t, i) { if (i) z[t.id] = scheduleLayout; });
		return z;
	}
	var wm = null;
	function applyDom() { if (wm) wm.apply(); }
	function makeWM() {
		var s = defaultLayout().split;
		wm = RvipWM({
			area: $('game'), menu: $('btn-layout'),
			wins: [{ id: 'main', title: 'Map' }, { id: 'inv', title: 'Inventory' }, { id: 'msg', title: 'Messages' }, { id: 'mon', title: 'Visible' }, { id: 'rec', title: 'Recall' }, { id: 'eqp', title: 'Equipment' }],
			multi: { d: 'v', r: s.bottom, a: { d: 'h', r: s.side, a: 'main', b: { d: 'v', r: s.inv, a: 'inv', b: 'mon' } }, b: 'msg' },
			single: 'main',
			state: L.wm,
			save: function (st) { L.wm = st; saveLayout(); },
			layout: function (r) {
				rects = r;
				TERMS.forEach(function (d, i) { if (terms[i]) fitCanvas(i); });
				scheduleSoon();
			},
			zoom: zooms(),   /* A-/A+ (the WM keeps the sizes): Map steps its tiles, the text windows get new cells */
			onReset: resetLayout
		});
		wm.apply();
	}

	/* Canvas area of a window (inside its border and title bar) */
	function inner(i) {
		var r = rects[TERMS[i].id] || [0, 0, 400, 240];     /* hidden: any size */
		return { w: Math.max(1, r[2] - BORDER), h: Math.max(1, r[3] - BORDER - ($('game').classList.contains('wm-single') ? 0 : TITLE_H)) };
	}

	/* Cell size, font and cols/rows for a window at the current zoom */
	function termShape(i) {
		var box = inner(i), cw, ch, font, cols, rows;
		if (!i) {
			ch = L.tile; cw = L.tile / 2;
			font = Math.floor(Math.min(ch * 0.8, cw / 0.62));
			/* text mode: the cell is as wide as the map font's glyphs (no overlap, no gaps) */
			if (L.text || !tilesReady) cw = Math.ceil(measure(font, 0));
			cols = clamp(Math.floor(box.w / cw), 80, 255);
			rows = clamp(Math.floor(box.h / ch), 24, 255);
		} else {
			font = RvipWM.fontSize(TERMS[i].id);
			cw = Math.ceil(measure(font, i)); ch = Math.round(font * 1.3);
			cols = clamp(Math.floor(box.w / cw), 1, 255);
			rows = clamp(Math.floor(box.h / ch), 1, 255);
		}
		return { cols: cols, rows: rows, cw: cw, ch: ch, font: font, face: face(i) };
	}

	/*
	 * A canvas bigger than its window (main window below 80x24, or a size
	 * the game hasn't applied yet) is scaled down to fit, never clipped.
	 */
	function fitCanvas(i) {
		var T = terms[i], box = inner(i);
		var w = T.cols * T.cw, h = T.rows * T.ch;
		var sc = Math.min(1, box.w / w, box.h / h);
		T.cv.style.width = (w * sc) + 'px';
		T.cv.style.height = (h * sc) + 'px';
	}

	/* (Re)size one term's canvas; resizing the canvas also blanks it */
	function configureTerm(i, l, cols, rows) {
		var cv = $('t-' + TERMS[i].id).querySelector('canvas');
		cv.width = cols * l.cw * dpr;
		cv.height = rows * l.ch * dpr;
		var ctx = cv.getContext('2d', { alpha: false });
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'center';
		ctx.font = l.font + 'px ' + l.face;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, cols * l.cw, rows * l.ch);
		terms[i] = { cv: cv, ctx: ctx, cols: cols, rows: rows,
			cw: l.cw, ch: l.ch, font: l.font, face: l.face, dpr: dpr };
		fitCanvas(i);
	}

	function buildTerms() {
		loadLayout();
		makeWM();
		TERMS.forEach(function (d, i) {
			var l = termShape(i);
			configureTerm(i, l, l.cols, l.rows);
		});
	}

	/*
	 * New window sizes or zoom: compute each term's new shape; the game
	 * applies it (qb.applyLayout) the next time it looks for input.
	 */
	var pending = null;

	function sameShape(T, l) {
		return T.cols === l.cols && T.rows === l.rows && T.cw === l.cw &&
			T.ch === l.ch && T.font === l.font && T.face === l.face;
	}

	function scheduleLayout() {
		if (!terms.length) return;
		dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
		pending = TERMS.map(function (d, i) {
			var l = termShape(i);
			/* Unchanged terms need no work (unless the pixel ratio changed) */
			return (!rects[d.id] || (sameShape(terms[i], l) && terms[i].dpr === dpr)) ? null : l;
		});
	}

	/* Throttled version for live dragging */
	var schedTimer = 0, schedLast = 0;
	function scheduleSoon() {
		var now = Date.now();
		clearTimeout(schedTimer);
		if (now - schedLast > 80) { schedLast = now; scheduleLayout(); }
		else schedTimer = setTimeout(function () { schedLast = Date.now(); scheduleLayout(); }, 80);
	}

	/* Zoom: main window tile size (text window sizes: the WM) */
	function zoomMain(dir) {
		var i = TILE_STEPS.indexOf(L.tile);
		var n = clamp(i + dir, 0, TILE_STEPS.length - 1);
		if (n === i) return;
		L.tile = TILE_STEPS[n];
		L.autoTile = false;
		scheduleLayout();
		saveLayout();
		status('Map tiles: ' + L.tile + ' px');
		clearTimeout(zoomMsgTimer);
		zoomMsgTimer = setTimeout(function () { status(''); }, 1200);
	}
	var zoomMsgTimer = 0;

	function resetLayout() {
		L = Object.assign(defaultLayout(), { audio: L.audio, text: L.text, face: L.face, mapFace: L.mapFace, wm: wm.state() });
		scheduleLayout();
		saveLayout();
	}

	/* Sub window titles: click to rename */
	function titleOf(id) {
		var d = TERMS.filter(function (t) { return t.id === id; })[0];
		return L.titles[id] || d.title;
	}

	function renderTitles() {
		TERMS.forEach(function (d, i) {
			if (!i) return;
			$('t-' + d.id).querySelector('.name').textContent = titleOf(d.id);
		});
	}

	function editTitle(id) {
		var name = $('t-' + id).querySelector('.name');
		if (name.querySelector('input')) return;
		var input = document.createElement('input');
		input.value = titleOf(id);
		input.maxLength = 60;
		input.setAttribute('aria-label', 'Window title');
		name.textContent = '';
		name.appendChild(input);
		input.focus();
		input.select();
		var done = false;
		function finish(keep) {
			if (done) return;
			done = true;
			var v = input.value.trim();
			if (keep) {
				var d = TERMS.filter(function (t) { return t.id === id; })[0];
				if (!v || v === d.title) delete L.titles[id];
				else L.titles[id] = v;
				saveLayout();
			}
			renderTitles();
		}
		input.addEventListener('keydown', function (e) {
			e.stopPropagation();
			if (e.key === 'Enter') { e.preventDefault(); finish(true); }
			else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
		});
		input.addEventListener('blur', function () { finish(true); });
	}

	/* ---------- drawing (called from C) ---------- */

	function color(a) {
		return palette[a] || palette[a & 0x0F] || '#fff';
	}

	function glyph(b) {
		if (b < 32 || b === 127) return ' ';
		return String.fromCharCode(b);
	}

	/* Sound effects (lib/xtra/sound/sound.cfg) and town music, both off by default */
	var audio = { sound: false, music: false, cfg: null, cache: {}, depth: -1,
		song: new Audio('music/new_town.ogg') };
	audio.song.loop = true;
	/* Read from the preloaded FS, never fetch(): a .cfg comes as octet-stream and
	   the Claude browser pane turns that into a download prompt. */
	function loadSoundCfg() {
		audio.cfg = {};
		var t = '';
		try { t = Module.FS.readFile('/tome2/lib/xtra/sound/sound.cfg', { encoding: 'utf8' }); } catch (e) { }
		t.split('\n').forEach(function (l) {
			var m = /^(\w+)\s*=\s*(.+)$/.exec(l.trim());
			if (m) audio.cfg[m[1]] = m[2].split(/\s+/);
		});
	}

	function updateMusic() {
		if (audio.music && audio.depth === 0) audio.song.play().catch(function () { });
		else audio.song.pause();
	}

	function toggleAudio(kind) {
		audio[kind] = !audio[kind];
		L.audio = { sound: audio.sound, music: audio.music };
		saveLayout();
		renderAudio();
		updateMusic();
	}

	function renderAudio() {
		$('chk-sound').checked = !!audio.sound;
		$('chk-music').checked = !!audio.music;
	}

	/* Tiles <-> text, applied by the game at its next command prompt */
	var tilesSwitch = -1;
	function toggleTiles() {
		if (!tilesReady) return;
		L.text = !L.text;
		scheduleLayout();   /* text mode sizes map cells from the font */
		tilesSwitch = L.text ? 0 : 1;
		saveLayout();
		renderTiles();
	}
	function tilesOn() { return tilesReady && !(L && L.text); }
	function renderTiles() { $('btn-tiles').textContent = 'Tiles: ' + (tilesOn() ? '16x16' : 'None'); renderMapSel(); }
	/* Map font select on the Map title bar, text mode only (shown on hover) */
	var mapSel = document.createElement('select');
	mapSel.title = 'Map font (text mode)';
	mapSel.innerHTML = '<option value="">Default font</option>';
	mapSel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });   /* not a window drag */
	function renderMapSel() {
		var bs = document.querySelector('#t-main .wm-btns');
		if (bs && mapSel.parentNode !== bs) bs.insertBefore(mapSel, bs.firstChild);
		mapSel.hidden = tilesOn();
		mapSel.value = (L && L.mapFace) || '';
		if ($('sel-font')) $('sel-font').value = (L && L.face) || '';
	}
	/* Fonts: faces from the index page's fonts/ (web/build.sh lists them) */
	var faceLoaded = {};
	function loadFace(n, now) {
		var redraw = function () { if (terms.length) scheduleLayout(); };
		if (!n || faceLoaded[n]) { if (now) redraw(); return; }
		var ff = new FontFace(n, 'url(../fonts/' + n + '.woff)');
		ff.load().then(function () { document.fonts.add(ff); faceLoaded[n] = true; redraw(); })
			.catch(function () { status('Could not load the font ' + n + '.', true); });
	}

	var qb = {
		sound: function (name) {
			if (!audio.cfg) loadSoundCfg();
			var files = audio.sound && audio.cfg[name];
			if (!files) return;
			var f = files[Math.floor(Math.random() * files.length)];
			if (!audio.cache[f]) audio.cache[f] = new Audio('sound/' + f);
			var a = audio.cache[f].cloneNode();
			a.volume = 0.6;
			a.play().catch(function () { });
		},

		depth: function (d) {
			if (d === audio.depth) return;
			audio.depth = d;
			updateMusic();
		},

		mouseX: 0, mouseY: 0, mouseB: 0,

		tilesWanted: function () { return tilesOn() ? 1 : 0; },
		tilesSwitch: function () { var s = tilesSwitch; tilesSwitch = -1; return s; },

		termCols: function (t) { return terms[t].cols; },
		termRows: function (t) { return terms[t].rows; },

		layoutPending: function (t) { return (pending && pending[t]) ? 1 : 0; },
		pendingCols: function (t) { return pending[t].cols; },
		pendingRows: function (t) { return pending[t].rows; },
		applyLayout: function (t, cols, rows) {
			var l = pending[t];
			pending[t] = null;
			configureTerm(t, l, cols, rows);
		},

		color: function (i, r, g, b) {
			palette[i] = 'rgb(' + r + ',' + g + ',' + b + ')';
		},

		clear: function (t) {
			if (!t) row0 = [];
			var T = terms[t];
			T.ctx.fillStyle = '#000';
			T.ctx.fillRect(0, 0, T.cols * T.cw, T.rows * T.ch);
		},

		wipe: function (t, x, y, n) {
			var T = terms[t];
			if (!t && !y) for (var j = 0; j < n; j++) row0[x + j] = ' ';
			T.ctx.fillStyle = '#000';
			T.ctx.fillRect(x * T.cw, y * T.ch, n * T.cw, T.ch);
		},

		text: function (t, x, y, n, a, s) {
			var T = terms[t], c = T.ctx, H = Module.HEAPU8;
			if (!t && !y) for (var j = 0; j < n; j++) row0[x + j] = String.fromCharCode(H[s + j] || 32);
			c.fillStyle = '#000';
			c.fillRect(x * T.cw, y * T.ch, n * T.cw, T.ch);
			c.fillStyle = color(a);
			var cy = y * T.ch + T.ch / 2 + 1;
			for (var i = 0; i < n; i++) {
				var ch = H[s + i];
				if (ch > 32) c.fillText(glyph(ch), (x + i) * T.cw + T.cw / 2, cy);
			}
		},

		pict: function (t, x, y, n, ap, cp, tap, tcp, eap, ecp) {
			var T = terms[t], c = T.ctx, H = Module.HEAPU8;
			var w = T.cw * 2, h = T.ch;
			var sw = tiles.naturalWidth, sh = tiles.naturalHeight;
			for (var i = 0; i < n; i++) {
				var a = H[ap + i], k = H[cp + i];
				var ta = H[tap + i], tk = H[tcp + i];
				var ea = H[eap + i], ek = H[ecp + i];
				var px = (x + i) * T.cw, py = y * T.ch;

				/* Right half of a big tile */
				if (a === 255 && k === 255) continue;

				/* Not a tile: plain text in a graphics call */
				if (!(a & 0x80) || !(k & 0x80) || !tilesReady) {
					c.fillStyle = '#000';
					c.fillRect(px, py, T.cw, h);
					if (k > 32) {
						c.fillStyle = color(a & 0x7F);
						c.fillText(glyph(k), px + T.cw / 2, py + h / 2 + 1);
					}
					continue;
				}

				var fx = (k & 0x7F) * TILE, fy = (a & 0x7F) * TILE;
				var bx = (tk & 0x7F) * TILE, by = (ta & 0x7F) * TILE;
				if (fx + TILE > sw || fy + TILE > sh) fx = fy = 0;
				if (bx + TILE > sw || by + TILE > sh) bx = by = 0;

				c.fillStyle = '#000';
				c.fillRect(px, py, w, h);
				if ((ta & 0x80) && (tk & 0x80) && (bx !== fx || by !== fy))
					c.drawImage(tiles, bx, by, TILE, TILE, px, py, w, h);
				c.drawImage(tiles, fx, fy, TILE, TILE, px, py, w, h);

				/* Terrain overlay ("ego" graphics, e.g. glyphs) on top */
				if (ea && ek && (ea & 0x80) && (ek & 0x80)) {
					var ox = (ek & 0x7F) * TILE, oy = (ea & 0x7F) * TILE;
					if (ox + TILE <= sw && oy + TILE <= sh)
						c.drawImage(tiles, ox, oy, TILE, TILE, px, py, w, h);
				}
			}
		},

		curs: function (t, x, y, w) {
			var T = terms[t], c = T.ctx;
			c.strokeStyle = '#ff0';
			c.lineWidth = 1;
			c.strokeRect(x * T.cw + 0.5, y * T.ch + 0.5, w * T.cw - 1, T.ch - 1);
		},

		fresh: function (t) { if (!t) RvipWM.prompt.text(row0.join('')); },   /* the message line over the map */

		bell: function () { },

		nextEvent: function (atCmd) {
			RvipWM.prompt.wait(atCmd);
			if (!events.length) return -1;
			var e = events.shift();
			if (e.mouse) {
				qb.mouseX = e.x; qb.mouseY = e.y; qb.mouseB = e.b;
				return 0x10000;
			}
			return e.k;
		},

		plog: function (msg) {
			console.warn('[tome2]', msg);
			status(msg, true);
		},

		sync: function () { app.sync(); },

		quit: function (msg) {
			app.running = false;
			app.sync();
			$('overlay-msg').textContent = msg ? msg : 'Your game has been saved.';
			$('overlay').hidden = false;
		}
	};

	/* ---------- input ---------- */

	function pushKey(k) { events.push({ k: k }); }

	function pushString(s) {
		for (var i = 0; i < s.length; i++) pushKey(s.charCodeAt(i));
	}

	/* X11-style macro trigger: ^_ [N][S][O] _ keysym \r  (see pref-x11.prf) */
	function pushKeysym(sym, e) {
		pushString('\x1f' + (e.ctrlKey ? 'N' : '') + (e.shiftKey ? 'S' : '') +
			(e.altKey ? 'O' : '') + '_' + sym.toString(16).toUpperCase() + '\r');
	}

	var KEYSYMS = {
		ArrowLeft: 0xFF51, ArrowUp: 0xFF52, ArrowRight: 0xFF53, ArrowDown: 0xFF54,
		Home: 0xFF50, End: 0xFF57, PageUp: 0xFF55, PageDown: 0xFF56,
		Insert: 0xFF63, Clear: 0xFF0B, Pause: 0xFF13,
		F1: 0xFFBE, F2: 0xFFBF, F3: 0xFFC0, F4: 0xFFC1, F5: 0xFFC2, F6: 0xFFC3,
		F7: 0xFFC4, F8: 0xFFC5, F9: 0xFFC6, F10: 0xFFC7, F11: 0xFFC8, F12: 0xFFC9
	};

	/* Keypad with Shift (NumLock on) arrives as KP_<nav> in X11 */
	var KP_NAV = [0xFF9E, 0xFF9C, 0xFF99, 0xFF9B, 0xFF96, 0xFF9D, 0xFF98, 0xFF95, 0xFF97, 0xFF9A];

	function onKey(e) {
		/* Typing a window title */
		if (e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
		if (!app.running || e.isComposing) return;
		if (e.metaKey) return;               /* leave Cmd shortcuts to the browser */
		var k = e.key, code = e.code || '';

		if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' ||
			k === 'CapsLock' || k === 'NumLock' || k === 'Dead') return;

		/* Numeric keypad: direction keys */
		var m = /^Numpad(\d)$/.exec(code);
		if (m) {
			var d = +m[1];
			if (e.shiftKey) pushKeysym(KP_NAV[d], { shiftKey: true });
			else if (e.ctrlKey || e.altKey) pushKeysym(0xFFB0 + d, e);
			else pushKeysym(0xFFB0 + d, {});
			e.preventDefault();
			return;
		}

		if (k === 'Escape') pushKey(27);
		else if (k === 'Enter') pushKey(13);
		else if (k === 'Tab') pushKey(9);
		else if (k === 'Backspace' || k === 'Delete') pushKey(8);
		else if (KEYSYMS[k]) pushKeysym(KEYSYMS[k], e);
		else if (k.length === 1) {
			var c = k.charCodeAt(0);
			if (e.ctrlKey && !e.altKey) {
				/* Control-letter and friends */
				var u = k.toUpperCase().charCodeAt(0);
				if (u >= 64 && u <= 95) pushKey(u & 0x1F);
				else pushKey(c);
			}
			else if (e.altKey && c < 128) {
				pushKeysym(c, { altKey: true, shiftKey: false });
			}
			else if (c < 256) pushKey(c);
			else return;
		}
		else return;

		e.preventDefault();
	}

	function onMouse(e) {
		if (!app.running) return;
		var T = terms[0], r = T.cv.getBoundingClientRect();
		var sx = r.width / (T.cols * T.cw), sy = r.height / (T.rows * T.ch);
		var x = Math.floor((e.clientX - r.left) / sx / T.cw);
		var y = Math.floor((e.clientY - r.top) / sy / T.ch);
		if (x < 0 || y < 0 || x >= T.cols || y >= T.rows) return;
		events.push({ mouse: true, x: x, y: y, b: e.button === 2 ? 3 : e.button === 1 ? 2 : 1 });
		e.preventDefault();
	}

	/* ---------- persistence (IndexedDB via IDBFS) ---------- */

	function mountPersistent() {
		var FS = Module.FS;
		PERSIST.forEach(function (d) {
			FS.mkdirTree(d);
			FS.mount(Module.IDBFS, {}, d);
		});
		Module.addRunDependency('idbfs');
		FS.syncfs(true, function (err) {
			if (err) {
				console.error(err);
				status('Could not read saved games from IndexedDB (' + err + '). ' +
					'Saving may not work in this browser mode.', true);
			}
			Module.removeRunDependency('idbfs');
		});
	}

	/* Savefiles in both save directories (not their subdirectories) */
	function listSaves() {
		var FS = Module.FS, out = [];
		SAVE_DIRS.forEach(function (d) {
			var names;
			try { names = FS.readdir(d); } catch (err) { return; }
			names.forEach(function (name) {
				var p = d + name;
				if (name === '.' || name === '..' || name === 'global.svg') return;
				if (FS.isFile(FS.stat(p).mode)) out.push(p);
			});
		});
		return out;
	}

	function removeSaves() {
		listSaves().forEach(function (p) { Module.FS.unlink(p); });
	}

	/* The savefile to export: the most recently written one */
	function saveFilePath() {
		var FS = Module.FS;
		var files = listSaves().filter(function (p) { return !/\.(new|old)$/.test(p); });
		files.sort(function (a, b) { return FS.stat(b).mtime - FS.stat(a).mtime; });
		return files[0];
	}

	/* ponytail: a Theme save is recognised by its module name near the start
	 * of the file; check the savefile header if this ever misfires */
	function isThemeSave(bytes) {
		var head = String.fromCharCode.apply(null, bytes.subarray(0, Math.min(bytes.length, 4096)));
		return head.indexOf('Theme') >= 0;
	}

	/* The -u name; ToME names savefiles after it without a uid prefix */
	var SAVE_NAME = 'PLAYER';

	/* ---------- startup ---------- */

	window.Module = {
		qb: qb,
		arguments: ['-u' + 'PLAYER'],
		noInitialRun: false,
		preRun: [function () {
			if (!tilesDone) {
				Module.addRunDependency('tiles');
				tilesWait = true;
			}
			/* Empty dirs aren't packaged; the game builds lib/data/*.raw at startup */
			['data', 'info', 'save', 'apex', 'xtra', 'note', 'cmov', 'patch', 'mods/theme/data', 'mods/theme/apex',
			 'mods/theme/save', 'mods/theme/note', 'mods/theme/user'].forEach(function (d) { Module.FS.mkdirTree('/tome2/lib/' + d); });
			/* Own paths: IndexedDB names come from the mount points, shared per origin */
			Module.FS.chdir('/tome2');
			mountPersistent();
		}],
		/* Terms must exist before main() runs (it asks for their sizes) */
		onRuntimeInitialized: function () {
			app.running = true;
			status('');
			$('game').hidden = false;
			buildTerms();
		},
		print: function (s) { console.log(s); },
		printErr: function (s) { console.warn(s); },
		setStatus: function (s) {
			if (s && !app.running) status(s.replace(/\(\d+\/\d+\)/, '').trim() || 'Loading…');
		},
		onAbort: function (what) { app.crashed(what); }
	};

	/* Tile sheet; main() waits for it */
	var tilesDone = false, tilesWait = false;
	function tilesFinished(ok) {
		tilesReady = ok;
		tilesDone = true;
		if (!ok) status('Could not load the tile set; using text.', true);
		if (L) renderTiles();
		if (tilesWait) Module.removeRunDependency('tiles');
	}
	tiles.onload = function () { tilesFinished(true); };
	tiles.onerror = function () { tilesFinished(false); };
	tiles.src = '16x16.png';

	document.addEventListener('keydown', onKey);
	document.addEventListener('DOMContentLoaded', function () {
		var mainCv = document.querySelector('#t-main canvas');
		mainCv.addEventListener('mousedown', onMouse);
		mainCv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
		$('chk-sound').onchange = function () { toggleAudio('sound'); };
		$('chk-music').onchange = function () { toggleAudio('music'); };
		RvipWM.dropdown($('btn-audio'), $('menu-audio'));
		RvipWM.dropdown($('btn-file'), $('menu-file'));
		$('btn-tiles').onclick = toggleTiles;
		RvipWM.fonts.then(function (list) {
			[[$('sel-font'), 'face'], [mapSel, 'mapFace']].forEach(function (a) {
				RvipWM.fontOptions(a[0]);
				a[0].value = (L && L[a[1]]) || '';
			});
		}).catch(function () { });
		[[$('sel-font'), 'face'], [mapSel, 'mapFace']].forEach(function (a) {
			a[0].onchange = function () {
				if (!L) return;
				L[a[1]] = this.value;
				saveLayout();
				loadFace(this.value, true);
				this.blur();
			};
		});
		renderAudio();
		renderTiles();

		/* Buttons never take the keyboard focus away from the game */
		document.querySelectorAll('button').forEach(function (b) {
			b.addEventListener('mousedown', function (e) { e.preventDefault(); });
		});

		TERMS.forEach(function (d, i) {
			if (!i) return;
			var w = $('t-' + d.id);
		});
		$('btn-restart').onclick = function () { location.reload(); };
	});

	/* Resize and reposition the windows when the browser window changes */
	var resizeTimer = 0;
	window.addEventListener('resize', function () {
		if (!terms.length) return;
		followWindow(L);
		applyDom();
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(scheduleLayout, 150);
	});

	/* Autosave when the tab is hidden; keep IndexedDB current */
	document.addEventListener('visibilitychange', function () {
		if (document.hidden && app.running && Module._web_request_save) Module._web_request_save();
		if (document.hidden) app.sync();
	});
	window.addEventListener('pagehide', function () { app.sync(); });
	window.addEventListener('beforeunload', function (e) {
		if (!app.running) return;
		app.sync();
		e.preventDefault();
		e.returnValue = '';
	});
	setInterval(function () { if (app.running) app.sync(); }, 15000);

	/* Autosave every two minutes (the game only saves when idle at the command prompt) */
	setInterval(function () {
		if (app.running && Module._web_request_save) Module._web_request_save();
	}, 120000);
})();
