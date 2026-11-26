/* AVR-Werkstatt – Bedienoberfläche */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const { CCompiler, AvrVM, ATmega8, AvrBoard, AVR_EXAMPLES } = window;
  const DELAY = AvrVM.DELAY, IOS = AvrVM.IOS;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('avr8.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('avr8.' + k, JSON.stringify(v)); } catch (e) { /* privat */ } },
  };
  const fmtNum = (v, d) => v.toFixed(d).replace('.', ',');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // =====================================================================
  // Farbschema
  // =====================================================================
  const savedTheme = LS.get('theme', null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  else if (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';
  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const nx = cur === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nx;
    LS.set('theme', nx);
  });

  // =====================================================================
  // Editor
  // =====================================================================
  let cm = null;
  const ta = $('#code');
  if (window.CodeMirror) {
    const base = CodeMirror.mimeModes['text/x-csrc'];
    const words = list => { const o = {}; list.forEach(w => { o[w] = true; }); return o; };
    const builtins = Object.keys(ATmega8.REGS).concat(Object.keys(CCompiler.BUILTINS), ATmega8.VECTORS, ['ISR', 'sei', 'cli', '_BV', 'bit_is_set', 'bit_is_clear', 'loop_until_bit_is_set', 'loop_until_bit_is_clear', 'pgm_read_byte', 'pgm_read_word', 'F_CPU', 'PROGMEM']);
    const bitNames = Object.keys(ATmega8.BITS);
    CodeMirror.defineMIME('text/x-avr', Object.assign({}, base, {
      builtin: words(builtins),
      atoms: words(['NULL', 'true', 'false'].concat(bitNames)),
      types: w => /^(u?int(8|16|32|64)_t|size_t|bool|_Bool|char|short|int|long|float|double|void|signed|unsigned)$/.test(w),
    }));
    // Assembler-Hervorhebung
    const asmWords = new Set(window.AvrAsm.MNEMONICS);
    const ioNames = new Set(Object.keys(window.AvrAsm.IO).map(x => x.toLowerCase()).concat(bitNames.map(x => x.toLowerCase()), ['ramend', 'low', 'high', 'xl', 'xh', 'yl', 'yh', 'zl', 'zh']));
    CodeMirror.defineMode('avrasm', () => ({
      startState: () => ({ block: false }),
      token(st, s) {
        if (s.block) { if (st.match(/^.*?\*\//)) s.block = false; else st.skipToEnd(); return 'comment'; }
        if (st.eatSpace()) return null;
        if (st.match('/*')) { s.block = true; return 'comment'; }
        if (st.match(';') || st.match('//')) { st.skipToEnd(); return 'comment'; }
        if (st.sol() && st.match(/^[A-Za-z_]\w*:/)) return 'def';
        if (st.match(/^[.#]\w+/)) return 'meta';
        if (st.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
        if (st.match(/^'(?:[^'\\]|\\.)'?/)) return 'string';
        if (st.match(/^(0[xX][0-9a-fA-F]+|\$[0-9a-fA-F]+|0[bB][01]+|\d+)/)) return 'number';
        const w = st.match(/^[A-Za-z_]\w*/);
        if (w) {
          const l = w[0].toLowerCase();
          if (/^r([12]?\d|3[01])$/.test(l)) return 'variable-3';
          if (asmWords.has(l)) return 'keyword';
          if (ioNames.has(l)) return 'builtin';
          return 'variable';
        }
        st.next();
        return 'operator';
      },
      lineComment: ';',
    }));
    cm = CodeMirror.fromTextArea(ta, {
      mode: 'text/x-avr', theme: 'avr', lineNumbers: true, gutters: ['bp-gutter', 'CodeMirror-linenumbers'],
      matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true, indentUnit: 4, tabSize: 4,
      indentWithTabs: false, lineWrapping: false,
      extraKeys: {
        'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
        Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
        'Shift-Tab': c => c.indentSelection('subtract'),
      },
    });
  }
  const ed = {
    get: () => (cm ? cm.getValue() : ta.value),
    set: v => { if (cm) { cm.setValue(v); cm.clearHistory(); } else ta.value = v; },
    on: fn => (cm ? cm.on('change', fn) : ta.addEventListener('input', fn)),
    goto(line) {
      if (!cm || !line) return;
      cm.setCursor({ line: line - 1, ch: 0 });
      cm.scrollIntoView({ line: line - 1, ch: 0 }, 80);
      cm.focus();
    },
  };

  // Haltepunkte
  function bpMarker() { const d = document.createElement('div'); d.className = 'bp'; d.textContent = '●'; d.title = 'Haltepunkt (klicken zum Entfernen)'; return d; }
  function toggleBp(line0) {
    if (!cm) return;
    const info = cm.lineInfo(line0);
    const has = info && info.gutterMarkers && info.gutterMarkers['bp-gutter'];
    cm.setGutterMarker(line0, 'bp-gutter', has ? null : bpMarker());
    bps = collectBps();
  }
  function collectBps() {
    const s = new Set();
    if (!cm) return s;
    let n = 0;
    cm.eachLine(h => { n++; if (h.gutterMarkers && h.gutterMarkers['bp-gutter']) s.add(n); });
    return s;
  }
  let bps = new Set();
  if (cm) {
    cm.on('gutterClick', (c, line, gutter) => { if (gutter === 'bp-gutter' || gutter === 'CodeMirror-linenumbers') toggleBp(line); });
    cm.on('cursorActivity', () => { const p = cm.getCursor(); $('#edInfo').textContent = 'Zeile ' + (p.line + 1) + ', Spalte ' + (p.ch + 1); });
  }

  // Zeilen markieren
  let execMark = null;
  function markExec(line, cls) {
    if (!cm) return;
    if (execMark && (execMark.line !== line || execMark.cls !== cls)) {
      cm.removeLineClass(execMark.h, 'background', execMark.cls);
      execMark = null;
    }
    if (line && !execMark) {
      const h = cm.getLineHandle(line - 1);
      if (!h) return;
      cm.addLineClass(h, 'background', cls);
      execMark = { line, cls, h };
    }
  }
  let errMarks = [];
  function markErrors(list) {
    if (!cm) return;
    errMarks.forEach(m => cm.removeLineClass(m.h, 'background', m.cls));
    errMarks = [];
    for (const it of list) {
      if (!it.line) continue;
      const h = cm.getLineHandle(it.line - 1);
      if (!h) continue;
      const cls = it.type === 'err' ? 'cm-err-line' : 'cm-warn-line';
      cm.addLineClass(h, 'background', cls);
      errMarks.push({ h, cls });
    }
  }

  // =====================================================================
  // Meldungen
  // =====================================================================
  const msgBox = $('#messages');
  const msg = {
    list: [],
    clear() { this.list = []; msgBox.innerHTML = ''; this.badge(); },
    add(type, text, line) {
      this.list.push({ type, text, line });
      const d = document.createElement('div');
      d.className = 'msg ' + type;
      const k = { err: '✖', warn: '⚠', ok: '✔', info: 'ℹ', tip: '💡' }[type] || '•';
      d.innerHTML = '<span class="k">' + k + '</span>' + (line ? '<span class="ln">Zeile ' + line + '</span>' : '') + '<span class="t">' + esc(text) + '</span>';
      if (line) { d.dataset.line = line; d.addEventListener('click', () => ed.goto(line)); }
      msgBox.appendChild(d);
      const sc = msgBox.parentElement;
      sc.scrollTop = sc.scrollHeight;
      this.badge();
    },
    badge() {
      const b = $('#msgBadge');
      const e = this.list.filter(m => m.type === 'err').length, w = this.list.filter(m => m.type === 'warn').length;
      b.className = 'badge' + (e ? ' err' : w ? ' warn' : '');
      b.textContent = e ? e : w ? w : '';
    },
  };

  // =====================================================================
  // Schaltung / Simulation
  // =====================================================================
  const mcu = new ATmega8();
  const board = new AvrBoard({ chip: $('#chip'), motor: $('#motorCard'), controls: $('#controls'), logic: $('#logic') });
  let cfg = Object.assign({}, AvrBoard.DEFAULT_CFG, LS.get('cfg', {}));
  board.setConfig(cfg);
  board.attach(mcu);

  let prog = null, vm = null, state = 'idle', clock = 1e6, realFactor = 0, lastFrame = performance.now();
  let codeAtStart = null;

  mcu.onWarn = text => msg.add('warn', text, vm ? lineOf() : 0);
  // serielle Ausgabe
  const serOut = $('#serialOut');
  let serBuf = '', serNew = 0, serDirty = false;
  mcu.onSerial = c => {
    if ($('#serHex').checked) serBuf += c.toString(16).toUpperCase().padStart(2, '0') + ' ';
    else if (c === 10) serBuf += '\n';
    else if (c === 13) { /* \r ignorieren */ }
    else if (c === 8) serBuf = serBuf.slice(0, -1);
    else serBuf += String.fromCharCode(c);
    if (serBuf.length > 30000) serBuf = serBuf.slice(-20000);
    serNew++; serDirty = true;
  };
  $('#serClear').addEventListener('click', () => { serBuf = ''; serDirty = true; });
  $('#serForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#serInput').value;
    if (!v) return;
    mcu.serialInput(v + '\r');
    $('#serInput').value = '';
    if (!(mcu.ucsrb & 0x10)) msg.add('warn', 'Text gesendet, aber der Empfänger ist nicht eingeschaltet (UCSRB |= (1<<RXEN)).');
  });

  function lineOf() { return vm && vm.cur ? vm.cur.line : 0; }

  function clockFor(p) {
    if (cfg.clock && cfg.clock !== 'auto') return +cfg.clock;
    return (p && p.fcpu) || 1e6;
  }
  function fmtHz(h) { return h >= 1e6 ? fmtNum(h / 1e6, h % 1e6 ? 4 : 0).replace(/,?0+$/, '') + ' MHz' : fmtNum(h / 1e3, 0) + ' kHz'; }

  // Sprache: aus der Dateiendung (.asm/.s/.inc = Assembler, sonst C)
  const langOf = name => (/\.(asm|s|inc)$/i.test(name || '') ? 'asm' : 'c');
  let lang = 'c';
  // Sprache umschalten; rename=true ändert auch die Dateiendung
  function setLang(l, rename) {
    if (rename === undefined) rename = true;
    lang = l;
    $('#selLang').value = l;
    $('.file-ic').textContent = l === 'asm' ? 'ASM' : 'C';
    if (cm) cm.setOption('mode', l === 'asm' ? 'avrasm' : 'text/x-avr');
    $('.tab[data-tab=vars]').textContent = l === 'asm' ? 'CPU-Register' : 'Variablen';
    if (rename) {
      const fn = $('#fileName');
      const base = fn.value.replace(/\.\w+$/, '');
      fn.value = base + (l === 'asm' ? '.asm' : '.c');
      if (typeof saveCurrent === 'function') saveCurrent();
    }
  }
  const looksAsm = code => /^\s*([A-Za-z_]\w*:\s*)?(ldi|out|in|rjmp|rcall|sbic|sbis|sbrc|sbrs|mov|lsl|cpi|breq|brne)\s+\S/im.test(code) && !/\bint\s+main\s*\(/.test(code);
  function compileSource(code) {
    return lang === 'asm' ? window.AvrAsm.assemble(code) : CCompiler.compile(code);
  }

  function compileNow(silentOk) {
    const code = ed.get();
    msg.clear();
    if (lang === 'c' && looksAsm(code)) { setLang('asm'); toast('Assembler erkannt – Sprache umgestellt'); }
    try {
      const p = compileSource(code);
      p.warnings.forEach(w => msg.add('warn', w.msg, w.line));
      markErrors(p.warnings.map(w => ({ type: 'warn', line: w.line })));
      if (!silentOk) {
        if (p.lang === 'asm') {
          msg.add('ok', 'Assembliert: 0 Fehler, ' + p.warnings.length + ' Warnung' + (p.warnings.length === 1 ? '' : 'en') +
            ' · Programm: ' + p.words + ' Wörter (' + (p.words * 2) + ' von 8192 Bytes Flash)' + (p.dseg ? ' · SRAM: ' + p.dseg + ' Bytes' : ''));
        } else {
          msg.add('ok', 'Übersetzt: 0 Fehler, ' + p.warnings.length + ' Warnung' + (p.warnings.length === 1 ? '' : 'en') +
            ' · RAM für Variablen: ' + p.ram + ' von 1024 Bytes' + (p.fcpu ? ' · F_CPU = ' + fmtHz(p.fcpu) : ''));
          if (p.ram > 900) msg.add('warn', 'Fast der ganze Arbeitsspeicher (1 KB) ist belegt – der Stack braucht auch noch Platz!');
        }
      }
      return p;
    } catch (e) {
      if (e instanceof CCompiler.CompileError) {
        msg.add('err', e.message, e.line);
        markErrors([{ type: 'err', line: e.line }]);
        if (e.line && cm) ed.goto(e.line);
        setTab('msg');
        return null;
      }
      msg.add('err', 'Interner Fehler im Compiler: ' + e.message);
      console.error(e);
      return null;
    }
  }

  function setState(s, text) {
    state = s;
    const st = $('#status');
    st.className = 'status ' + ({ idle: 'idle', run: 'run', pause: 'pause', done: 'done', err: 'err' }[s]);
    st.textContent = text || { idle: 'Bereit', run: 'Läuft', pause: 'Pause', done: 'Beendet', err: 'Fehler' }[s];
    $('#btnRun').querySelector('.lbl').textContent = s === 'pause' ? 'Weiter' : 'Start';
    $('#btnRun').title = s === 'pause' ? 'Weiter (F5)' : 'Übersetzen und starten (F5)';
    $('#btnRun').disabled = s === 'run';
    $('#btnPause').disabled = s !== 'run';
    $('#btnStop').disabled = !(s === 'run' || s === 'pause');
    $('#btnStep').disabled = s === 'run';
    $('#statusbar').className = 'statusbar' + (s === 'err' ? ' err' : s === 'pause' ? ' pause' : '');
    if (window.AndroidApp && AndroidApp.keepScreenOn) AndroidApp.keepScreenOn(s === 'run');
    if (s === 'pause' || s === 'err' || s === 'done') { renderVars(true); renderRegs(); }
  }

  function prepare() {
    const p = compileNow(false);
    if (!p) { setState('err', 'Fehler beim Übersetzen'); return false; }
    prog = p;
    clock = clockFor(p);
    board.clock = clock;
    board.resetSim();
    if (p.lang === 'asm') {
      vm = new window.AvrAsm.AsmVM(p, mcu, {
        clock,
        onTip: t => msg.add('tip', t, lineOf()),
        onWarn: t => msg.add('warn', t, lineOf()),
      });
    } else vm = new AvrVM(p, mcu, {});
    board.applyInputs();
    serBuf = ''; serDirty = true; serNew = 0;
    codeAtStart = ed.get();
    bps = collectBps();
    $('#sbClock').textContent = 'Takt: ' + fmtHz(clock);
    $('#sbRam').textContent = p.lang === 'asm' ? 'Flash: ' + p.words * 2 + ' / 8192 B' : 'RAM: ' + p.ram + ' / 1024 B';
    if (p.lang === 'asm' && p.builtins.size && !p.fcpu && cfg.clock === 'auto') msg.add('info', 'Takt 1 MHz (Werkseinstellung). Die eingebauten Warteschleifen (' + Array.from(p.builtins.keys()).join(', ') + ') warten genau ihre Zeit.');
    if (p.delayFcpu && Math.abs(p.delayFcpu - clock) > 1) {
      msg.add('warn', 'F_CPU im Programm (' + fmtHz(p.delayFcpu) + ') passt nicht zum Takt des Chips (' + fmtHz(clock) + ') – alle Wartezeiten sind ' + fmtNum(p.delayFcpu / clock, 2) + '× so lang wie gedacht.');
    }
    if (!p.fcpu && cfg.clock === 'auto' && p.lang !== 'asm') msg.add('info', 'Kein F_CPU im Programm – der Chip läuft mit 1 MHz (Werkseinstellung).');
    for (const [vi, f] of p.isrs) {
      if (f.enableHint) {
        const src = codeAtStart;
        if (!new RegExp('\\b' + f.enableHint[1] + '\\b').test(src)) msg.add('tip', 'ISR(' + ATmega8.VECTORS[vi] + ') ist programmiert – vergiss nicht, den Interrupt freizugeben (' + f.enableHint[0] + ' |= (1<<' + f.enableHint[1] + ')) und sei() aufzurufen.', f.line);
        else if (!/\bsei\s*\(/.test(src)) msg.add('tip', 'Es gibt eine ISR, aber kein sei() – ohne sei() werden keine Interrupts ausgeführt.', f.line);
      }
    }
    return true;
  }

  function start() {
    if (state === 'pause') { setState('run'); markExec(0); lastFrame = performance.now(); return; }
    if (!prepare()) return;
    msg.add('info', 'Programm läuft (' + fmtHz(clock) + ', Tempo ' + $('#selSpeed').selectedOptions[0].textContent + ').');
    setState('run');
    lastFrame = performance.now();
  }

  function pause(reason) {
    if (state !== 'run') return;
    setState('pause', reason === 'bp' ? 'Haltepunkt' : 'Pause');
    markExec(lineOf(), 'cm-exec-line');
    if (reason === 'bp') { msg.add('info', 'Haltepunkt erreicht.', lineOf()); ed.goto(lineOf()); }
  }

  function stop() {
    if (!vm) return;
    setState('idle', 'Gestoppt');
    markExec(0);
    mcu.reset();
    board.stepper.t = 0; board.stepper.hist = [[0, 0]]; board.stepper.samples = [];
    board.applyInputs();
    board.onPins(0);
  }

  function step() {
    if (state === 'run') return;
    if (state !== 'pause') {
      if (!prepare()) return;
      msg.add('info', 'Einzelschritt-Modus: Mit "Schritt" (F10) geht es Anweisung für Anweisung weiter, mit "Weiter" (F5) läuft das Programm normal.');
    }
    vm.horizon = Infinity;
    try {
      for (let i = 0; i < 2000000; i++) {
        const r = vm.gen.next();
        if (r.done) { finished(); return; }
        if (r.value !== DELAY) { vm.cur = r.value; break; }
      }
    } catch (e) { runtimeError(e); return; }
    setState('pause', 'Einzelschritt');
    markExec(lineOf(), 'cm-exec-line');
    if (cm) { const l = lineOf(); if (l) cm.scrollIntoView({ line: l - 1, ch: 0 }, 60); }
  }

  function finished() {
    setState('done');
    markExec(0);
    msg.add('info', 'Programm beendet: main() ist zu Ende. Ein echter Mikrocontroller bleibt dann einfach stehen – deshalb gehört in main() eine Endlosschleife while (1) { … }.');
  }

  function runtimeError(e) {
    if (e instanceof CCompiler.RuntimeError) {
      const l = lineOf();
      msg.add('err', 'Laufzeitfehler: ' + e.message, l);
      setState('err', 'Laufzeitfehler');
      markExec(l, 'cm-err-line');
      setTab('msg');
      if (l) ed.goto(l);
    } else {
      console.error(e);
      msg.add('err', 'Interner Fehler im Simulator: ' + e.message, lineOf());
      setState('err');
    }
  }

  function runSlice(dt) {
    const sp = $('#selSpeed').value;
    const c0 = mcu.cycles;
    const target = sp === 'max' ? c0 + clock * 2 : c0 + dt * (+sp) * clock;
    vm.horizon = target;
    const deadline = performance.now() + 14;
    const useBp = bps.size > 0;
    let n = 0;
    try {
      while (mcu.cycles < target) {
        const r = vm.gen.next();
        if (r.done) { finished(); break; }
        const v = r.value;
        if (v !== DELAY) {
          vm.cur = v;
          if (useBp && bps.has(v.line)) { pause('bp'); break; }
        }
        if ((++n & 255) === 0 && performance.now() > deadline) break;
      }
    } catch (e) { runtimeError(e); }
    realFactor = dt > 0 ? (mcu.cycles - c0) / (dt * clock) : 0;
  }

  // =====================================================================
  // Hauptschleife
  // =====================================================================
  let lastSlow = 0, lastVars = 0;
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (state === 'run' && vm) {
      runSlice(dt);
      if (state === 'run') markExec(lineOf(), 'cm-exec-line-run');
    }
    board.render();
    if (now - lastSlow > 100) {
      lastSlow = now;
      const t = mcu.cycles / clock;
      $('#sbTime').textContent = 'Zeit: ' + fmtNum(t, 3) + ' s';
      $('#sbReal').textContent = state === 'run' ? 'Echtzeit: ' + fmtNum(realFactor, realFactor < 0.1 ? 3 : 2) + '×' + (($('#selSpeed').value !== 'max' && realFactor < +$('#selSpeed').value * 0.8) ? ' (PC zu langsam)' : '') : 'Echtzeit: –';
      if (serDirty) {
        serDirty = false;
        const atBottom = serOut.scrollTop + serOut.clientHeight >= serOut.scrollHeight - 20;
        serOut.textContent = serBuf;
        if (atBottom) serOut.scrollTop = serOut.scrollHeight;
        const b = $('#serBadge');
        if (activeTab !== 'serial' && serNew) { b.className = 'badge info'; b.textContent = serNew > 999 ? '999+' : serNew; }
        else { serNew = 0; b.className = 'badge'; b.textContent = ''; }
      }
    }
    if (state === 'run' && now - lastVars > 250) {
      lastVars = now;
      if (activeTab === 'vars') renderVars(false);
      if (activeTab === 'regs') renderRegs();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // =====================================================================
  // Variablen
  // =====================================================================
  const varsBox = $('#vars');
  let lastVals = new Map();
  function ptrText(p) {
    if (p === null || p === undefined || p === 0) return 'NULL';
    if (typeof p !== 'object') return String(p);
    if (p.s === IOS) return '→ ' + p.i;
    return '→ ' + p.s.name + (p.s.d.length > 1 ? '[' + p.i + ']' : '');
  }
  function scalarText(t, v) {
    if (t.k === 'ptr') return ptrText(v);
    if (t.k === 'float') return (+v).toPrecision(6).replace(/\.?0+$/, '').replace('.', ',');
    if (t.k === 'bool') return v ? 'true (1)' : 'false (0)';
    if (typeof v !== 'number') return String(v);
    const bits = t.bits || 16;
    const u = bits === 32 ? v >>> 0 : v & ((1 << bits) - 1);
    let s = String(v);
    s += '  0x' + u.toString(16).toUpperCase().padStart(bits / 4, '0');
    if (bits === 8) s += '  0b' + u.toString(2).padStart(8, '0');
    if (bits === 8 && v >= 32 && v < 127) s += "  '" + String.fromCharCode(v) + "'";
    return s;
  }
  function storeText(st, type) {
    if (!st) return '(noch nicht angelegt)';
    if (type.k !== 'arr') return scalarText(type, st.d[0]);
    const base = st.t;
    if (base.k === 'int' && base.bits === 8 && base.s && base.name === 'char') {
      let s = '';
      for (const c of st.d) { if (c === 0) break; s += c >= 32 && c < 127 ? String.fromCharCode(c) : '\\x' + (c & 255).toString(16); }
      return '"' + s + '"  ' + '{' + st.d.slice(0, 16).join(', ') + (st.d.length > 16 ? ', …' : '') + '}';
    }
    const fmt = v => (base.k === 'ptr' ? ptrText(v) : base.k === 'float' ? (+v).toPrecision(4) : (base.k === 'int' && base.bits === 8 && !base.s ? '0x' + (v & 255).toString(16).toUpperCase().padStart(2, '0') : String(v)));
    const n = st.d.length;
    return '{' + st.d.slice(0, 48).map(fmt).join(', ') + (n > 48 ? ', … (' + n + ' Werte)' : '') + '}';
  }
  function renderAsmVars() {
    const R = vm.R, h2 = v => v.toString(16).toUpperCase().padStart(2, '0');
    const cells = [];
    for (let i = 0; i < 32; i++) {
      const v = R[i];
      const key = 'r' + i, txt = String(v);
      const old = lastVals.get(key); lastVals.set(key, txt);
      const chg = old !== undefined && old !== txt && state === 'pause';
      const nm = prog.defs.get(i) || ({ 26: 'XL', 27: 'XH', 28: 'YL', 29: 'YH', 30: 'ZL', 31: 'ZH' })[i] || '';
      cells.push('<tr class="' + (chg ? 'chg' : '') + '"><td><b>r' + i + '</b></td><td class="muted">' + esc(nm) + '</td><td class="v">0x' + h2(v) + '</td><td class="v">' + v + '</td><td class="v">0b' + v.toString(2).padStart(8, '0') + '</td></tr>');
    }
    const s = mcu.sreg;
    const flags = 'ITHSVNZC'.split('').map((f, k) => '<span class="flag' + ((s >> (7 - k)) & 1 ? ' on' : '') + '" title="' + ['Interrupts erlaubt', 'T-Bit', 'Halbübertrag', 'Vorzeichen (N⊕V)', 'Überlauf (Zweierkomplement)', 'Negativ (Bit 7)', 'Zero (Ergebnis = 0)', 'Carry (Übertrag)'][k] + '">' + f + '</span>').join('');
    const pc = vm.cur ? vm.cur.addr : vm.pc;
    let lbl = '';
    for (const [a, n] of prog.labels) if (a <= pc && (!lbl || a >= lbl[0])) lbl = [a, n];
    const stack = [];
    for (let a = vm.sp + 1; a <= 0x45F && stack.length < 12; a++) stack.push('0x' + h2(vm.ram[a - 0x60]));
    const vars = prog.varLabels.map(v => esc(v.name) + ' = ' + vm.ram[v.addr - 0x60] + ' (0x' + h2(vm.ram[v.addr - 0x60]) + ')');
    const isr = vm.isrCount.map((c, i) => (c ? ATmega8.VECTORS[i] + ': ' + c + '×' : '')).filter(Boolean);
    varsBox.innerHTML = '<div class="cpu-top">' +
      '<div><small>SREG</small><div class="flags">' + flags + '</div></div>' +
      '<div><small>PC</small><b>0x' + pc.toString(16).toUpperCase().padStart(3, '0') + '</b>' + (lbl ? ' <span class="muted">' + esc(lbl[1]) + (pc > lbl[0] ? '+' + (pc - lbl[0]) : '') + '</span>' : '') + '</div>' +
      '<div><small>SP</small><b>0x' + vm.sp.toString(16).toUpperCase() + '</b></div>' +
      '<div><small>Stack (oben zuerst)</small><span class="v">' + (stack.length ? stack.join(' ') : '(leer)') + '</span></div>' +
      (vars.length ? '<div><small>Variablen (.dseg)</small><span class="v">' + vars.join(' · ') + '</span></div>' : '') +
      '</div>' +
      '<table class="regtab"><thead><tr><th>Reg.</th><th>Name</th><th>Hex</th><th>Dez</th><th>Binär</th></tr></thead><tbody>' + cells.join('') + '</tbody></table>' +
      (isr.length ? '<p class="muted small">Interrupts ausgeführt: ' + esc(isr.join(' · ')) + '</p>' : '');
  }

  function renderVars(force) {
    if (!vm || !prog) { varsBox.innerHTML = '<p class="muted">Starte das Programm, dann siehst du hier alle ' + (lang === 'asm' ? 'Register r0 … r31 und die Flags' : 'Variablen') + '. Am besten mit ❚❚ Pause oder einem Haltepunkt.</p>'; return; }
    if (prog.lang === 'asm') { renderAsmVars(); return; }
    const rows = [];
    const row = (key, name, type, text) => {
      const old = lastVals.get(key);
      lastVals.set(key, text);
      const chg = old !== undefined && old !== text && state === 'pause';
      rows.push('<tr class="' + (chg ? 'chg' : '') + '"><td>' + esc(name) + '</td><td class="muted">' + esc(CCompiler.typeName(type)) + '</td><td class="' + (type.k === 'arr' ? 'arr' : 'v') + '">' + esc(text) + '</td></tr>');
    };
    if (prog.globals.length) {
      rows.push('<tr class="sec"><td colspan="3">Globale Variablen</td></tr>');
      for (const g of prog.globals) row('g:' + g.name, g.name, g.type, storeText(g.store, g.type));
    }
    const frames = vm.frames();
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      rows.push('<tr class="sec"><td colspan="3">' + esc(f.fn.name) + '()  ·  Zeile ' + f.line + (i === frames.length - 1 ? '  ◀ aktuell' : '') + '</td></tr>');
      let any = false;
      for (const s of f.fn.locals) {
        const st = s.static ? s.store : f.vars[s.slot];
        if (!st) continue;
        any = true;
        row('l' + i + ':' + f.fn.name + ':' + s.name + ':' + s.slot, (s.static ? 'static ' : '') + s.name, s.type, storeText(st, s.type));
      }
      if (!any) rows.push('<tr><td colspan="3" class="muted">(keine lokalen Variablen)</td></tr>');
    }
    if (!frames.length) rows.push('<tr><td colspan="3" class="muted">Programm ist nicht in einer Funktion.</td></tr>');
    const isr = vm.isrCount.map((c, i) => (c ? ATmega8.VECTORS[i] + ': ' + c + '×' : '')).filter(Boolean);
    varsBox.innerHTML = '<table><thead><tr><th>Name</th><th>Typ</th><th>Wert</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      (isr.length ? '<p class="muted small">Interrupts ausgeführt: ' + esc(isr.join(' · ')) + '</p>' : '');
  }

  // =====================================================================
  // Register
  // =====================================================================
  const REG_GROUPS = [
    ['Port B', ['DDRB', 'PORTB', 'PINB']], ['Port C', ['DDRC', 'PORTC', 'PINC']], ['Port D', ['DDRD', 'PORTD', 'PIND']],
    ['Status & Interrupts', ['SREG', 'GICR', 'GIFR', 'MCUCR', 'TIMSK', 'TIFR']],
    ['Timer 0 / Timer 2', ['TCCR0', 'TCNT0', 'TCCR2', 'TCNT2', 'OCR2']],
    ['Timer 1', ['TCCR1A', 'TCCR1B', 'TCNT1', 'OCR1A', 'OCR1B', 'ICR1']],
    ['ADC', ['ADMUX', 'ADCSRA', 'ADCW']], ['UART', ['UCSRA', 'UCSRB', 'UBRRL']],
  ];
  const regsBox = $('#regs');
  const regEls = {};
  (function buildRegs() {
    let h = '';
    for (const [title, regs] of REG_GROUPS) {
      h += '<div class="reg-sec">' + title + '</div>';
      for (const r of regs) {
        const w = ATmega8.REGS[r];
        h += '<div class="reg" data-r="' + r + '"><span class="n">' + r + '</span>';
        if (w === 8) { h += '<span class="bits">'; for (let b = 7; b >= 0; b--) h += '<span title="Bit ' + b + '">' + b + '</span>'; h += '</span>'; }
        else h += '<span></span>';
        h += '<span class="h"></span></div>';
      }
    }
    regsBox.innerHTML = h;
    for (const d of regsBox.querySelectorAll('.reg')) regEls[d.dataset.r] = { bits: Array.from(d.querySelectorAll('.bits span')), h: d.querySelector('.h'), last: -1 };
  })();
  function renderRegs() {
    for (const r in regEls) {
      const e = regEls[r];
      const v = mcu.read(r);
      if (v === e.last) continue;
      e.last = v;
      if (e.bits.length) {
        e.bits.forEach((s, k) => s.classList.toggle('on', !!((v >> (7 - k)) & 1)));
        e.h.textContent = '0x' + v.toString(16).toUpperCase().padStart(2, '0') + ' = ' + v;
      } else e.h.textContent = '0x' + v.toString(16).toUpperCase().padStart(4, '0') + ' = ' + v;
    }
  }

  // =====================================================================
  // Reiter
  // =====================================================================
  let activeTab = 'msg';
  function setTab(t) {
    activeTab = t;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    $$('.tab-body').forEach(b => b.classList.toggle('active', b.dataset.body === t));
    if (t === 'vars') renderVars(true);
    if (t === 'regs') renderRegs();
    if (t === 'serial') { serNew = 0; serDirty = true; }
  }
  $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#laWin').addEventListener('change', e => { board.laWindow = +e.target.value; });

  // =====================================================================
  // Dateien
  // =====================================================================
  const files = () => LS.get('files', {});
  const fileName = $('#fileName');
  function normName(n) { n = (n || 'main').trim().replace(/[\\/:*?"<>|]/g, '_'); if (!/\.\w+$/.test(n)) n += (lang === 'asm' ? '.asm' : '.c'); return n; }
  let baseCode = '';
  function updateDirty() {
    const dirty = baseCode !== ed.get();
    $('#dirty').classList.toggle('on', dirty);
    $('#dirty').title = dirty ? 'Geändert – noch nicht unter "Meine Programme" gespeichert' : 'Unverändert';
    return dirty;
  }
  function saveCurrent() { LS.set('current', { name: fileName.value, code: ed.get(), base: baseCode }); }
  function saveFile() {
    const name = normName(fileName.value);
    fileName.value = name;
    const all = files();
    all[name] = { code: ed.get(), t: Date.now() };
    LS.set('files', all);
    baseCode = ed.get();
    saveCurrent();
    updateDirty();
    toast('💾 "' + name + '" gespeichert');
    $('#sbSaved').textContent = 'gespeichert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    renderFileList();
  }
  function loadCode(name, code) {
    if (state === 'run' || state === 'pause') stop();
    setLang(langOf(name), false);
    ed.set(code);
    baseCode = code;
    fileName.value = name;
    saveCurrent(); updateDirty();
    markErrors([]); markExec(0);
    lint();
  }
  function confirmDiscard() { return !updateDirty() || ed.get().trim() === '' || confirm('Das aktuelle Programm ist nicht gespeichert. Trotzdem fortfahren?'); }
  function download() {
    const name = normName(fileName.value);
    if (window.AndroidApp && AndroidApp.saveFile) { AndroidApp.saveFile(name, ed.get()); return; }
    const blob = new Blob([ed.get()], { type: 'text/x-csrc;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function renderFileList() {
    const ul = $('#fileList');
    const all = files();
    const names = Object.keys(all).sort((a, b) => all[b].t - all[a].t);
    if (!names.length) { ul.innerHTML = '<li class="empty">Noch keine Programme gespeichert.</li>'; return; }
    ul.innerHTML = '';
    for (const n of names) {
      const li = document.createElement('li');
      if (n === normName(fileName.value)) li.className = 'cur';
      li.innerHTML = '<span class="fn"></span><span class="dt"></span><button class="mini" title="Löschen">🗑</button>';
      li.querySelector('.fn').textContent = n;
      li.querySelector('.dt').textContent = new Date(all[n].t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
      li.querySelector('.fn').addEventListener('click', () => { if (!confirmDiscard()) return; loadCode(n, all[n].code); $('#dlgFiles').close(); });
      li.querySelector('button').addEventListener('click', () => {
        if (!confirm('"' + n + '" wirklich löschen?')) return;
        const a2 = files(); delete a2[n]; LS.set('files', a2); renderFileList(); updateDirty();
      });
      ul.appendChild(li);
    }
  }
  $('#btnFiles').addEventListener('click', () => { renderFileList(); $('#dlgFiles').showModal(); });
  $('#fClose').addEventListener('click', () => $('#dlgFiles').close());
  $('#fSave').addEventListener('click', saveFile);
  $('#fDownload').addEventListener('click', download);
  $('#fNew').addEventListener('click', () => {
    if (!confirmDiscard()) return;
    let n = 1; const all = files();
    const ext = lang === 'asm' ? '.asm' : '.c';
    while (all['programm' + n + ext]) n++;
    loadCode('programm' + n + ext, AVR_EXAMPLES.find(x => x.id === (lang === 'asm' ? 'asm_vorlage' : 'vorlage')).code);
    $('#dlgFiles').close();
  });
  $('#fUpload').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    if (!confirmDiscard()) { e.target.value = ''; return; }
    const r = new FileReader();
    r.onload = () => { loadCode(normName(f.name), String(r.result).replace(/\r\n/g, '\n')); $('#dlgFiles').close(); toast('📂 "' + f.name + '" geöffnet'); };
    r.readAsText(f);
    e.target.value = '';
  });
  fileName.addEventListener('change', () => {
    fileName.value = normName(fileName.value);
    setLang(langOf(fileName.value), false);
    saveCurrent(); updateDirty(); lint();
  });
  $('#selLang').addEventListener('change', e => { setLang(e.target.value); lint(); });

  // Beispiele (nach Sprache gruppiert)
  const selEx = $('#selExample');
  for (const [lg, title] of [['asm', 'Assembler'], ['c', 'C']]) {
    const og = document.createElement('optgroup');
    og.label = title;
    for (const ex of AVR_EXAMPLES.filter(x => (x.lang || 'c') === lg)) { const o = document.createElement('option'); o.value = ex.id; o.textContent = ex.title; og.appendChild(o); }
    selEx.appendChild(og);
  }
  selEx.addEventListener('change', () => {
    const ex = AVR_EXAMPLES.find(x => x.id === selEx.value);
    selEx.value = '';
    if (!ex || !confirmDiscard()) return;
    loadCode(ex.id + (ex.lang === 'asm' ? '.asm' : '.c'), ex.code);
    msg.clear();
    msg.add('info', 'Beispiel "' + ex.title + '" geladen – drücke ▶ Start.');
    if (ex.cfg) {
      const nc = Object.assign({}, cfg, ex.cfg);
      if (JSON.stringify(nc) !== JSON.stringify(cfg)) {
        cfg = nc; LS.set('cfg', cfg); board.setConfig(cfg); board.onPins(0);
        msg.add('tip', 'Die Schaltung wurde für dieses Beispiel angepasst: ' + ex.cfgText + ' (änderbar unter ⚙ Schaltung).');
      }
    }
    if (ex.id === 'lauflicht' && cfg.ledPort !== 'D') msg.add('tip', 'Für dieses Beispiel unter ⚙ Schaltung die LED-Zeile auf PORTD stellen.');
  });

  // =====================================================================
  // Einstellungen
  // =====================================================================
  const form = $('#settingsForm');
  const ALL_PINS = [];
  ['B', 'C', 'D'].forEach(p => { for (let b = 0; b < (p === 'C' ? 6 : 8); b++) ALL_PINS.push('P' + p + b); });
  const mpinRow = $('#mpinRow');
  for (let k = 0; k < 4; k++) {
    const l = document.createElement('label');
    l.innerHTML = '<span class="mpl">IN' + (k + 1) + '</span> <select name="mp' + k + '">' + ALL_PINS.map(p => '<option>' + p + '</option>').join('') + '</select>';
    mpinRow.appendChild(l);
  }
  form.querySelectorAll('.pinsel').forEach(s => { s.innerHTML = '<option value="">nicht angeschlossen</option>' + ALL_PINS.map(p => '<option>' + p + '</option>').join(''); });
  function fillSettings(c) {
    form.motor.value = c.motor; form.steps.value = c.steps; form.maxRate.value = c.maxRate; form.driver.value = c.driver;
    for (let k = 0; k < 4; k++) form['mp' + k].value = c.mpins[k];
    form.s1.value = c.s1; form.s2.value = c.s2; form.extPullup.checked = !!c.extPullup;
    form.potCh.value = c.potCh; form.ledPort.value = c.ledPort; form.clock.value = c.clock;
    updDriverLabels();
  }
  function updDriverLabels() {
    const n = form.driver.value === 'l293' ? ['A1', 'A2', 'B1', 'B2'] : ['IN1', 'IN2', 'IN3', 'IN4'];
    form.querySelectorAll('.mpl').forEach((s, k) => { s.textContent = n[k]; });
  }
  form.driver.addEventListener('change', updDriverLabels);
  form.motor.addEventListener('change', () => {
    const m = AvrBoard.MOTORS[form.motor.value];
    if (m) { form.steps.value = m.steps; form.maxRate.value = m.maxRate; }
  });
  [form.steps, form.maxRate].forEach(i => i.addEventListener('input', () => { form.motor.value = 'custom'; }));
  $('#btnSettings').addEventListener('click', () => { fillSettings(cfg); $('#dlgSettings').showModal(); });
  $('#btnDefaults').addEventListener('click', () => fillSettings(AvrBoard.DEFAULT_CFG));
  $('#dlgSettings').addEventListener('close', () => {
    if ($('#dlgSettings').returnValue !== 'ok') return;
    const mp = [0, 1, 2, 3].map(k => form['mp' + k].value);
    const nc = {
      motor: form.motor.value, steps: Math.max(4, +form.steps.value || 2048), maxRate: Math.max(10, +form.maxRate.value || 650),
      driver: form.driver.value, mpins: mp, s1: form.s1.value, s2: form.s2.value, extPullup: form.extPullup.checked,
      potCh: +form.potCh.value, ledPort: form.ledPort.value, clock: form.clock.value,
    };
    if (new Set(mp).size < 4) toast('⚠ Zwei Motor-Anschlüsse liegen auf demselben Pin');
    const clockChanged = nc.clock !== cfg.clock;
    cfg = nc; LS.set('cfg', cfg);
    board.setConfig(cfg);
    board.onPins(0);
    if (clockChanged && (state === 'run' || state === 'pause')) toast('Der neue Takt gilt beim nächsten Start');
    else toast('✔ Schaltung übernommen');
  });

  // =====================================================================
  // Hilfe
  // =====================================================================
  $('#helpBody').innerHTML = window.AVR_HELP || '';
  $('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());
  $('#hClose').addEventListener('click', () => $('#dlgHelp').close());

  // =====================================================================
  // Knöpfe & Tastatur
  // =====================================================================
  $('#btnRun').addEventListener('click', start);
  $('#btnPause').addEventListener('click', () => pause());
  $('#btnStop').addEventListener('click', stop);
  $('#btnStep').addEventListener('click', step);
  $('#btnCheck').addEventListener('click', () => { if (compileNow(false)) setTab('msg'); });
  $('#selSpeed').addEventListener('change', () => LS.set('speed', $('#selSpeed').value));
  const sp = LS.get('speed', null); if (sp) $('#selSpeed').value = sp;

  const inEditable = el => el && (el.closest('.CodeMirror') || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener('keydown', e => {
    if (e.key === 'F5') { e.preventDefault(); if (e.shiftKey) stop(); else start(); return; }
    if (e.key === 'F6') { e.preventDefault(); pause(); return; }
    if (e.key === 'F7') { e.preventDefault(); compileNow(false); setTab('msg'); return; }
    if (e.key === 'F10') { e.preventDefault(); step(); return; }
    if (e.key === 'F9') { e.preventDefault(); if (cm) toggleBp(cm.getCursor().line); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
    if (!inEditable(document.activeElement) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '1') board.press1(true);
      if (e.key === '2') board.press2(true);
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === '1' && board.btnEls[0] && !board.btnEls[0].classList.contains('latched')) board.press1(false);
    if (e.key === '2' && board.btnEls[1] && !board.btnEls[1].classList.contains('latched')) board.press2(false);
  });

  // =====================================================================
  // Trennbalken
  // =====================================================================
  function drag(handle, onMove) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('drag');
      const mv = ev => onMove(ev);
      const up = () => { handle.classList.remove('drag'); handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); if (cm) cm.refresh(); LS.set('layout', { hw: getComputedStyle(document.documentElement).getPropertyValue('--hw-w'), panel: getComputedStyle(document.documentElement).getPropertyValue('--panel-h') }); };
      handle.addEventListener('pointermove', mv);
      handle.addEventListener('pointerup', up);
    });
  }
  drag($('#splitV'), e => {
    const w = Math.max(330, Math.min(window.innerWidth - 380, e.clientX));
    document.documentElement.style.setProperty('--hw-w', w + 'px');
  });
  drag($('#splitH'), e => {
    const r = $('#ide').getBoundingClientRect();
    const h = Math.max(80, Math.min(r.height - 120, r.bottom - e.clientY));
    document.documentElement.style.setProperty('--panel-h', h + 'px');
    if (cm) cm.refresh();
  });
  const lay = LS.get('layout', null);
  if (lay) {
    if (lay.hw && lay.hw.trim()) document.documentElement.style.setProperty('--hw-w', lay.hw.trim());
    if (lay.panel && lay.panel.trim()) document.documentElement.style.setProperty('--panel-h', lay.panel.trim());
  }

  // =====================================================================
  // Live-Prüfung beim Tippen
  // =====================================================================
  let lintTm = null, editHinted = false;
  function lint() {
    clearTimeout(lintTm);
    lintTm = setTimeout(() => {
      if (state === 'run' || state === 'pause') return;
      try {
        const p = compileSource(ed.get());
        markErrors(p.warnings.map(w => ({ type: 'warn', line: w.line })));
        if (msg.list.some(m => m.type === 'err')) { msg.clear(); p.warnings.forEach(w => msg.add('warn', w.msg, w.line)); msg.add('ok', 'Keine Fehler mehr 👍'); }
      } catch (e) {
        if (e instanceof CCompiler.CompileError) {
          markErrors([{ type: 'err', line: e.line }]);
          msg.clear(); msg.add('err', e.message, e.line);
        }
      }
    }, 800);
  }
  let saveTm = null;
  ed.on(() => {
    clearTimeout(saveTm);
    saveTm = setTimeout(() => { saveCurrent(); updateDirty(); }, 400);
    lint();
    if ((state === 'run' || state === 'pause') && !editHinted && ed.get() !== codeAtStart) {
      editHinted = true;
      toast('Änderungen gelten erst nach Stopp und neuem Start');
    }
  });

  // =====================================================================
  // Start
  // =====================================================================
  const cur = LS.get('current', null);
  if (cur && cur.code) { fileName.value = cur.name || 'main.c'; setLang(langOf(fileName.value), false); ed.set(cur.code); baseCode = typeof cur.base === 'string' ? cur.base : cur.code; }
  else {
    const ex = AVR_EXAMPLES.find(x => x.id === 'asm_halbschritt');
    fileName.value = 'asm_halbschritt.asm'; setLang('asm', false); ed.set(ex.code); baseCode = ex.code;
    if (!LS.get('cfg', null)) { cfg = Object.assign({}, cfg, ex.cfg); LS.set('cfg', cfg); board.setConfig(cfg); }
  }
  updateDirty();
  setState('idle');
  renderVars();
  msg.add('info', 'Willkommen in der AVR-Werkstatt! Links ist dein ATmega8 mit Schrittmotor, rechts schreibst du das Programm – in Assembler oder C (umschalten oben neben dem Dateinamen).');
  msg.add('tip', 'Drücke ▶ Start (F5). Unter 📚 Beispiele gibt es fertige Programme, unter ? Hilfe alle Befehle und Tastenkürzel.');
  if (!LS.get('seenHelp', false)) { LS.set('seenHelp', true); }
  $('#sbClock').textContent = 'Takt: ' + fmtHz(clockFor(null));

  // Android-App: Zurück-Taste schließt zuerst offene Dialoge
  window.avrBack = () => {
    const d = $$('dialog').find(x => x.open);
    if (d) { d.close(); return true; }
    return false;
  };
  if (window.AndroidApp) document.documentElement.classList.add('in-app');

  if (!window.AndroidApp && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* egal */ });
  }
  window.avrApp = { mcu, board, get vm() { return vm; }, get state() { return state; }, start, stop, step, pause, ed };
})();
