/* AVR-Assembler (Syntax wie AVRASM2 / Atmel Studio / myAVR) und
 * befehlsgenauer Prozessor für den ATmega8.
 */
(function (G) {
  'use strict';
  const AVR = G.ATmega8;
  const { CompileError, RuntimeError } = G.CCompiler;

  // ---------- I/O-Adressen (I/O-Raum, für in/out) ----------
  const IO = {
    SREG: 0x3F, SPH: 0x3E, SPL: 0x3D, GICR: 0x3B, GIFR: 0x3A, TIMSK: 0x39, TIFR: 0x38, SPMCR: 0x37, TWCR: 0x36,
    MCUCR: 0x35, MCUCSR: 0x34, TCCR0: 0x33, TCNT0: 0x32, OSCCAL: 0x31, SFIOR: 0x30, TCCR1A: 0x2F, TCCR1B: 0x2E,
    TCNT1H: 0x2D, TCNT1L: 0x2C, OCR1AH: 0x2B, OCR1AL: 0x2A, OCR1BH: 0x29, OCR1BL: 0x28, ICR1H: 0x27, ICR1L: 0x26,
    TCCR2: 0x25, TCNT2: 0x24, OCR2: 0x23, ASSR: 0x22, WDTCR: 0x21, UBRRH: 0x20, UCSRC: 0x20, EEARH: 0x1F, EEARL: 0x1E,
    EEDR: 0x1D, EECR: 0x1C, PORTB: 0x18, DDRB: 0x17, PINB: 0x16, PORTC: 0x15, DDRC: 0x14, PINC: 0x13, PORTD: 0x12,
    DDRD: 0x11, PIND: 0x10, SPDR: 0x0F, SPSR: 0x0E, SPCR: 0x0D, UDR: 0x0C, UCSRA: 0x0B, UCSRB: 0x0A, UBRRL: 0x09,
    ACSR: 0x08, ADMUX: 0x07, ADCSRA: 0x06, ADCSR: 0x06, ADCH: 0x05, ADCL: 0x04, TWDR: 0x03, TWAR: 0x02, TWSR: 0x01, TWBR: 0x00,
  };
  const IONAME = [];
  for (const [n, a] of Object.entries(IO)) if (IONAME[a] === undefined) IONAME[a] = n;
  IONAME[0x20] = 'UBRRH'; IONAME[0x06] = 'ADCSRA';

  const VEC_ADDR = {
    INT0addr: 1, INT1addr: 2, OC2addr: 3, OVF2addr: 4, ICP1addr: 5, OC1Aaddr: 6, OC1Baddr: 7, OVF1addr: 8, OVF0addr: 9,
    SPIaddr: 10, URXCaddr: 11, UDREaddr: 12, UTXCaddr: 13, ADCCaddr: 14, ERDYaddr: 15, ACIaddr: 16, TWIaddr: 17, SPMRaddr: 18,
  };

  // ---------- Befehlstabelle ----------
  // f: Operandenformat, c: Takte
  const T = {};
  const def = (names, f, c) => names.split(' ').forEach(n => { T[n] = { f, c }; });
  def('add adc sub sbc and or eor cp cpc cpse mov', 'dr', 1);
  def('mul', 'dr', 2);
  def('muls', 'dr16', 2);
  def('mulsu fmul fmuls fmulsu', 'dr23', 2);
  def('movw', 'ww', 1);
  def('ldi cpi subi sbci andi ori sbr cbr', 'dK', 1);
  def('com neg inc dec tst clr lsl lsr rol ror asr swap', 'd', 1);
  def('ser', 'd16', 1);
  def('push pop', 'd', 2);
  def('adiw sbiw', 'wK', 2);
  def('rjmp', 'k', 2); def('rcall', 'k', 3);
  def('jmp call', 'kl', 3);
  def('ijmp', '-', 2); def('icall', '-', 3); def('ret reti', '-', 4);
  def('nop sleep wdr spm sec clc sen cln sez clz sei cli ses cls sev clv set clt seh clh break', '-', 1);
  def('breq brne brcs brcc brsh brlo brmi brpl brge brlt brhs brhc brts brtc brvs brvc brie brid', 'b', 1);
  def('brbs brbc', 'sb', 1);
  def('sbrc sbrs', 'rbit', 1);
  def('bst bld', 'rbit', 1);
  def('sbic sbis', 'Abit', 1);
  def('sbi cbi', 'Abit', 2);
  def('in', 'dA', 1); def('out', 'Ar', 1);
  def('ld', 'dP', 2); def('st', 'Pr', 2);
  def('ldd', 'dQ', 2); def('std', 'Qr', 2);
  def('lds', 'dk16', 2); def('sts', 'k16r', 2);
  def('lpm', 'lpm', 3); def('elpm', 'lpm', 3);
  def('bset bclr', 's', 1);

  const BR = { breq: [1, 1], brne: [1, 0], brcs: [0, 1], brlo: [0, 1], brcc: [0, 0], brsh: [0, 0], brmi: [2, 1], brpl: [2, 0],
    brvs: [3, 1], brvc: [3, 0], brlt: [4, 1], brge: [4, 0], brhs: [5, 1], brhc: [5, 0], brts: [6, 1], brtc: [6, 0], brie: [7, 1], brid: [7, 0] };
  const FLAGOP = { sec: [0, 1], clc: [0, 0], sez: [1, 1], clz: [1, 0], sen: [2, 1], cln: [2, 0], sev: [3, 1], clv: [3, 0],
    ses: [4, 1], cls: [4, 0], seh: [5, 1], clh: [5, 0], set: [6, 1], clt: [6, 0], sei: [7, 1], cli: [7, 0] };

  // interne Befehlsnummern (schneller als Text-Vergleiche)
  const OPS = ['add', 'adc', 'sub', 'sbc', 'and', 'or', 'eor', 'cp', 'cpc', 'cpse', 'mov', 'mul', 'muls', 'mulsu', 'fmul', 'fmuls', 'fmulsu',
    'movw', 'ldi', 'cpi', 'subi', 'sbci', 'andi', 'ori', 'com', 'neg', 'inc', 'dec', 'lsr', 'ror', 'asr', 'swap', 'push', 'pop',
    'adiw', 'sbiw', 'rjmp', 'rcall', 'ijmp', 'icall', 'ret', 'reti', 'nop', 'sleep', 'wdr', 'brbs', 'brbc', 'sbrc', 'sbrs', 'bst', 'bld',
    'sbic', 'sbis', 'sbi', 'cbi', 'in', 'out', 'ld', 'st', 'lds', 'sts', 'lpm', 'bset', 'bclr', 'wait', 'spm', 'break'];
  const OP = {}; OPS.forEach((n, i) => { OP[n] = i; });

  function lev(a, b) {
    const m = a.length, n = b.length, d = [];
    for (let i = 0; i <= m; i++) { d[i] = [i]; }
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function suggest(word, list, max) {
    let best = null, bd = 99;
    for (const c of list) { const d = lev(word.toLowerCase(), c.toLowerCase()); if (d < bd) { bd = d; best = c; } }
    return best && bd <= (max || 2) ? best : null;
  }

  // =====================================================================
  // Ausdrücke
  // =====================================================================
  function tokenizeExpr(s, line) {
    const t = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      let m;
      if ((m = /^(0[xX][0-9a-fA-F]+|\$[0-9a-fA-F]+|0[bB][01]+|\d+)/.exec(s.slice(i)))) {
        const x = m[1];
        let v;
        if (/^0[xX]/.test(x)) v = parseInt(x.slice(2), 16);
        else if (x[0] === '$') v = parseInt(x.slice(1), 16);
        else if (/^0[bB]/.test(x)) v = parseInt(x.slice(2), 2);
        else v = parseInt(x, 10);
        if (/^[A-Za-z_]/.test(s[i + x.length] || '')) throw new CompileError('Ungültige Zahl "' + x + s[i + x.length] + '…"', line);
        t.push({ t: 'n', v }); i += x.length; continue;
      }
      if (c === "'") {
        let v, j = i + 1;
        if (s[j] === '\\') { const e = s[j + 1]; v = { n: 10, r: 13, t: 9, 0: 0, '\\': 92, "'": 39 }[e]; if (v === undefined) v = e.charCodeAt(0); j += 2; }
        else { v = s.charCodeAt(j); j++; }
        if (s[j] !== "'") throw new CompileError("Zeichen-Literal nicht geschlossen (fehlendes ')", line);
        t.push({ t: 'n', v }); i = j + 1; continue;
      }
      if ((m = /^[A-Za-z_][\w]*/.exec(s.slice(i)))) { t.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      const two = s.substr(i, 2);
      if (['<<', '>>', '<=', '>=', '==', '!=', '&&', '||'].includes(two)) { t.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/%&|^~!()<>,'.includes(c)) { t.push({ t: 'op', v: c }); i++; continue; }
      throw new CompileError('Unerwartetes Zeichen "' + c + '" im Ausdruck', line);
    }
    return t;
  }
  const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
  const FUNCS = {
    low: v => v & 0xFF, high: v => (v >> 8) & 0xFF, byte1: v => v & 0xFF, byte2: v => (v >> 8) & 0xFF, byte3: v => (v >> 16) & 0xFF, byte4: v => (v >>> 24) & 0xFF,
    lwrd: v => v & 0xFFFF, hwrd: v => (v >>> 16) & 0xFFFF, page: v => (v >> 16) & 0x3F, exp2: v => Math.pow(2, v), log2: v => Math.floor(Math.log2(v)), abs: v => Math.abs(v),
  };

  // =====================================================================
  // Assembler
  // =====================================================================
  function assemble(src) {
    const warnings = [];
    const warn = (msg, line) => { if (!warnings.some(w => w.msg === msg && w.line === line)) warnings.push({ msg, line: line || 0 }); };
    const once = new Set();
    const warnOnce = (k, msg, line) => { if (!once.has(k)) { once.add(k); warn(msg, line); } };

    // Symbole (Groß-/Kleinschreibung egal)
    const sym = new Map();      // name -> {v, kind}
    const regdef = new Map();   // .def name -> Registernummer
    const setSym = (n, v, kind) => sym.set(n.toLowerCase(), { v, kind, name: n });
    for (const [n, a] of Object.entries(IO)) setSym(n, a, 'io');
    for (const [n, v] of Object.entries(AVR.BITS)) setSym(n, v, 'bit');
    for (const [n, v] of Object.entries(VEC_ADDR)) setSym(n, v, 'vec');
    setSym('RAMEND', 0x45F, 'const'); setSym('FLASHEND', 0xFFF, 'const'); setSym('E2END', 0x1FF, 'const');
    setSym('SRAM_START', 0x60, 'const'); setSym('SRAM_SIZE', 1024, 'const'); setSym('PAGESIZE', 32, 'const');
    [['XL', 26], ['XH', 27], ['YL', 28], ['YH', 29], ['ZL', 30], ['ZH', 31]].forEach(([n, r]) => regdef.set(n.toLowerCase(), r));

    // ---- Zeilen vorbereiten: Kommentare entfernen ----
    const raw = src.replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    let inBlock = false;
    raw.forEach((text, i) => {
      let out = '', j = 0, q = null;
      while (j < text.length) {
        const c = text[j];
        if (inBlock) { if (c === '*' && text[j + 1] === '/') { inBlock = false; j += 2; } else j++; continue; }
        if (q) { out += c; if (c === '\\') { out += text[j + 1] || ''; j += 2; continue; } if (c === q) q = null; j++; continue; }
        if (c === '"' || c === "'") { q = c; out += c; j++; continue; }
        if (c === ';') break;
        if (c === '/' && text[j + 1] === '/') break;
        if (c === '/' && text[j + 1] === '*') { inBlock = true; j += 2; continue; }
        out += c; j++;
      }
      lines.push({ text: out, line: i + 1 });
    });

    // ---- Durchgang 1: Adressen, Labels, Direktiven ----
    const items = [];         // Befehle und Daten im Flash
    const macros = new Map();
    let seg = 'c', pc = 0, dpc = 0x60, epc = 0;
    let macroDef = null;
    const cond = [];
    let active = true;
    let exited = false;
    const orgAddrs = new Set();
    const work = lines.slice();
    let fcpu = null;

    const evalExpr = (s, line, allowUndef) => {
      const toks = tokenizeExpr(s, line);
      let p = 0;
      const peek = () => toks[p];
      const primary = () => {
        const t = toks[p++];
        if (!t) throw new CompileError('Ausdruck unvollständig: "' + s.trim() + '"', line);
        if (t.t === 'n') return t.v;
        if (t.t === 'op') {
          if (t.v === '(') { const v = expr(0); if (!toks[p] || toks[p].v !== ')') throw new CompileError('")" fehlt in "' + s.trim() + '"', line); p++; return v; }
          if (t.v === '-') return -primary();
          if (t.v === '+') return primary();
          if (t.v === '~') return ~primary();
          if (t.v === '!') return primary() ? 0 : 1;
          throw new CompileError('Unerwartet "' + t.v + '" in "' + s.trim() + '"', line);
        }
        const name = t.v, lname = name.toLowerCase();
        if (FUNCS[lname] && toks[p] && toks[p].v === '(') {
          p++; const v = expr(0);
          if (!toks[p] || toks[p].v !== ')') throw new CompileError('")" fehlt nach ' + name + '(', line);
          p++; return FUNCS[lname](v);
        }
        if (lname === 'pc') return pc;
        const sv = sym.get(lname);
        if (sv) return sv.v;
        if (allowUndef) { allowUndef.undef = true; return 0; }
        if (/^r\d+$/i.test(name) || regdef.has(lname)) throw new CompileError('Hier wird eine Zahl/Adresse erwartet, kein Register ("' + name + '")', line);
        const s2 = suggest(name, Array.from(sym.values()).map(x => x.name));
        throw new CompileError('"' + name + '" ist unbekannt' + (s2 ? ' – meintest du "' + s2 + '"?' : ' (Label oder .equ fehlt?)'), line);
      };
      const expr = minP => {
        let left = primary();
        for (;;) {
          const t = peek();
          if (!t || t.t !== 'op' || !PREC[t.v] || PREC[t.v] < minP) return left;
          p++;
          const r = expr(PREC[t.v] + 1);
          switch (t.v) {
            case '+': left = left + r; break; case '-': left = left - r; break; case '*': left = left * r; break;
            case '/': if (!r) throw new CompileError('Division durch 0', line); left = Math.trunc(left / r); break;
            case '%': left = left % r; break; case '<<': left = left * Math.pow(2, r); break; case '>>': left = Math.floor(left / Math.pow(2, r)); break;
            case '&': left = left & r; break; case '|': left = left | r; break; case '^': left = left ^ r; break;
            case '<': left = +(left < r); break; case '>': left = +(left > r); break; case '<=': left = +(left <= r); break; case '>=': left = +(left >= r); break;
            case '==': left = +(left === r); break; case '!=': left = +(left !== r); break; case '&&': left = +(left && r); break; case '||': left = +(left || r); break;
          }
        }
      };
      if (!toks.length) throw new CompileError('Wert fehlt', line);
      const v = expr(0);
      if (p < toks.length) throw new CompileError('Unerwartet "' + toks[p].v + '" in "' + s.trim() + '"', line);
      return v;
    };

    const splitOps = s => {
      const out = []; let cur = '', depth = 0, q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; continue; } if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; cur += c; continue; }
        if (c === '(') depth++; if (c === ')') depth--;
        if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      if (cur.trim() || out.length) out.push(cur.trim());
      return out;
    };

    const defineLabel = (name, line) => {
      const l = name.toLowerCase();
      if (/^r\d+$/.test(l) || T[l]) throw new CompileError('"' + name + '" ist ein Register/Befehl und kann kein Label sein', line);
      const old = sym.get(l);
      if (old && old.kind === 'label') throw new CompileError('Label "' + name + '" gibt es schon (Zeile ' + old.line + ')', line);
      if (old && old.kind !== 'label' && old.kind !== 'equ') warn('Label "' + name + '" überdeckt den Namen ' + old.name, line);
      sym.set(l, { v: seg === 'c' ? pc : seg === 'd' ? dpc : epc, kind: 'label', name, line, seg });
    };

    while (work.length) {
      const { text, line, fromMacro } = work.shift();
      if (exited) break;
      let s = text.trim();
      if (!s) continue;
      // Makro-Definition aufzeichnen
      if (macroDef) {
        if (/^\.endm(acro)?\b/i.test(s)) { macros.set(macroDef.name, macroDef); macroDef = null; }
        else macroDef.body.push(s);
        continue;
      }
      // bedingte Assemblierung
      const cm = /^[.#](if|ifdef|ifndef|elif|else|endif)\b\s*(.*)$/i.exec(s);
      if (cm) {
        const d = cm[1].toLowerCase(), rest = cm[2];
        if (d === 'if' || d === 'ifdef' || d === 'ifndef') {
          let v = false;
          if (active) {
            if (d === 'if') v = !!evalExpr(rest, line);
            else { const n = rest.trim().toLowerCase(); v = sym.has(n) === (d === 'ifdef'); }
          }
          cond.push({ parent: active, taken: v, line }); active = active && v;
        } else if (d === 'elif') {
          const top = cond[cond.length - 1]; if (!top) throw new CompileError('.elif ohne .if', line);
          if (top.taken) active = false; else { const v = top.parent && !!evalExpr(rest, line); top.taken = v; active = v; }
        } else if (d === 'else') {
          const top = cond[cond.length - 1]; if (!top) throw new CompileError('.else ohne .if', line);
          active = top.parent && !top.taken; top.taken = true;
        } else {
          const top = cond.pop(); if (!top) throw new CompileError('.endif ohne .if', line);
          active = top.parent;
        }
        continue;
      }
      if (!active) continue;

      // Label
      let m = /^([A-Za-z_][\w]*)\s*:(?!:)\s*(.*)$/.exec(s);
      if (m) { defineLabel(m[1], line); s = m[2].trim(); if (!s) continue; }

      // Direktiven
      if (s[0] === '.' || s[0] === '#') {
        const dm = /^[.#]\s*(\w+)\s*(.*)$/.exec(s);
        if (!dm) throw new CompileError('Ungültige Direktive', line);
        const d = dm[1].toLowerCase(), rest = dm[2].trim();
        switch (d) {
          case 'include': {
            const f = rest.replace(/^["<]|[">]$/g, '');
            if (!/^m8(def)?\.inc$/i.test(f) && !/^m8adef\.inc$/i.test(f)) warn('Datei "' + f + '" gibt es im Simulator nicht – wird ignoriert. (Warte-Routinen wie Wait10ms sind eingebaut.)', line);
            continue;
          }
          case 'device':
            if (!/^atmega8a?$/i.test(rest)) warn('.device ' + rest + ' – der Simulator ist ein ATmega8', line);
            continue;
          case 'equ': case 'set': case 'define': {
            let em = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(rest);
            if (d === 'define') em = /^([A-Za-z_]\w*)\s+(.+)$/.exec(rest) || em;
            if (!em) {
              if (d === 'define' && /^[A-Za-z_]\w*$/.test(rest)) { setSym(rest, 1, 'equ'); continue; }
              throw new CompileError('.' + d + ' braucht die Form: .' + d + ' NAME = Wert', line);
            }
            const ln = em[1].toLowerCase();
            const old = sym.get(ln);
            if (d === 'equ' && old && old.kind === 'equ') throw new CompileError('.equ ' + em[1] + ' gibt es schon – zum Ändern .set benutzen', line);
            if (d === 'equ' && old && old.kind === 'label') throw new CompileError('"' + em[1] + '" ist schon ein Label', line);
            const v = evalExpr(em[2], line);
            sym.set(ln, { v, kind: 'equ', name: em[1], line });
            if (ln === 'f_cpu') fcpu = v;
            continue;
          }
          case 'def': {
            const em = /^([A-Za-z_]\w*)\s*=\s*([rR](\d+)|[A-Za-z_]\w*)$/.exec(rest);
            if (!em) throw new CompileError('.def braucht die Form: .def name = r16', line);
            let r;
            if (em[3] !== undefined) r = +em[3]; else r = regdef.get(em[2].toLowerCase());
            if (r === undefined || r > 31) throw new CompileError('.def: "' + em[2] + '" ist kein Register (r0 … r31)', line);
            regdef.set(em[1].toLowerCase(), r);
            continue;
          }
          case 'undef': regdef.delete(rest.toLowerCase()); continue;
          case 'cseg': seg = 'c'; continue;
          case 'dseg': seg = 'd'; continue;
          case 'eseg': seg = 'e'; continue;
          case 'org': {
            const v = evalExpr(rest, line);
            if (seg === 'c') { if (v < pc && items.some(it => it.addr >= v && it.addr < pc)) warn('.org ' + v + ' überschreibt schon belegten Programmspeicher', line); pc = v; orgAddrs.add(v); }
            else if (seg === 'd') { if (v < 0x60) warn('.org im .dseg sollte ab 0x60 (SRAM_START) liegen', line); dpc = v; }
            else epc = v;
            continue;
          }
          case 'byte': {
            const n = evalExpr(rest, line);
            if (seg === 'd') dpc += n; else if (seg === 'e') epc += n; else throw new CompileError('.byte geht nur im Datensegment (.dseg)', line);
            continue;
          }
          case 'db': case 'dw': case 'dd': {
            if (seg === 'd') throw new CompileError('.' + d + ' geht nicht im .dseg (dort .byte benutzen)', line);
            const ops = splitOps(rest);
            const bytes = [];
            for (const o of ops) {
              if (o[0] === '"') {
                if (d !== 'db') throw new CompileError('Zeichenketten gehen nur mit .db', line);
                const str = o.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\0/g, '\0').replace(/\\(.)/g, '$1');
                for (const ch of str) bytes.push(ch.charCodeAt(0) & 0xFF);
              } else {
                const v = evalExpr(o, line, {});
                if (d === 'db') bytes.push(v & 0xFF);
                else if (d === 'dw') bytes.push(v & 0xFF, (v >> 8) & 0xFF);
                else bytes.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF);
              }
            }
            if (seg === 'e') { epc += bytes.length; continue; }
            if (bytes.length % 2) { bytes.push(0); if (d === 'db') warn('.db mit ungerader Anzahl Bytes – ein 0-Byte wird angehängt', line); }
            items.push({ kind: 'data', d, ops, addr: pc, words: bytes.length / 2, line, bytes });
            pc += bytes.length / 2;
            continue;
          }
          case 'macro': {
            const nm = rest.split(/\s+/)[0];
            if (!nm) throw new CompileError('.macro braucht einen Namen', line);
            macroDef = { name: nm.toLowerCase(), body: [], line };
            continue;
          }
          case 'endm': case 'endmacro': throw new CompileError('.endm ohne .macro', line);
          case 'exit': exited = true; continue;
          case 'error': throw new CompileError('.error ' + rest, line);
          case 'warning': case 'message': warn(rest.replace(/^"|"$/g, ''), line); continue;
          case 'list': case 'nolist': case 'listmac': case 'pragma': case 'overlap': case 'nooverlap': case 'csegsize': continue;
          default: throw new CompileError('Unbekannte Direktive ".' + dm[1] + '"', line);
        }
      }

      // Befehl
      m = /^([A-Za-z_]\w*)\s*(.*)$/.exec(s);
      if (!m) throw new CompileError('Unverständliche Zeile: "' + s + '"', line);
      const mn = m[1].toLowerCase();
      let opsText = m[2];
      if (macros.has(mn)) {
        const mac = macros.get(mn);
        const args = splitOps(opsText);
        const body = mac.body.map(b => ({ text: b.replace(/@(\d)/g, (_, k) => (args[+k] !== undefined ? args[+k] : '@' + k)), line, fromMacro: mn }));
        work.unshift(...body);
        continue;
      }
      if (seg !== 'c') throw new CompileError('Befehle gehören ins Codesegment (.cseg), nicht ins ' + (seg === 'd' ? '.dseg' : '.eseg'), line);
      const info = T[mn];
      if (!info) {
        if (!opsText.trim()) {
          throw new CompileError('Unbekannter Befehl "' + m[1] + '"' + (suggest(mn, Object.keys(T), 1) ? ' – meintest du "' + suggest(mn, Object.keys(T), 1) + '"?' : ' – falls es ein Label sein soll, fehlt der Doppelpunkt: ' + m[1] + ':'), line);
        }
        const sg = suggest(mn, Object.keys(T).concat(Array.from(macros.keys())), 2);
        throw new CompileError('Unbekannter Befehl "' + m[1] + '"' + (sg ? ' – meintest du "' + sg + '"?' : ''), line);
      }
      if (mn === 'jmp' || mn === 'call') throw new CompileError('"' + mn + '" gibt es beim ATmega8 nicht (nur 8 KB Flash) – benutze "r' + mn + '"', line);
      if (mn === 'elpm' || mn === 'break') throw new CompileError('"' + mn + '" gibt es beim ATmega8 nicht', line);
      const words = (mn === 'lds' || mn === 'sts') ? 2 : 1;
      items.push({ kind: 'ins', mn, src: m[1], opsText, addr: pc, words, line, fromMacro });
      pc += words;
    }
    if (macroDef) throw new CompileError('.macro ' + macroDef.name + ' ohne .endm', macroDef.line);
    if (cond.length) throw new CompileError('.if ohne .endif', cond[cond.length - 1].line);
    if (pc > 4096) throw new CompileError('Programm ist zu groß: ' + pc + ' Wörter, der ATmega8 hat nur 4096 Wörter (8 KB) Flash', 0);
    if (dpc > 0x460) throw new CompileError('.dseg braucht ' + (dpc - 0x60) + ' Bytes, der ATmega8 hat nur 1024 Bytes SRAM', 0);

    // ---- Durchgang 2: Operanden auswerten ----
    const code = new Array(4096);
    const flash = new Uint8Array(8192).fill(0xFF);
    const builtins = new Map();
    let usesStack = false, setsSP = false;

    const reg = (o, line, min, max, what) => {
      const t = (o || '').trim();
      if (!t) throw new CompileError('Register fehlt' + (what ? ' (' + what + ')' : ''), line);
      let r;
      const rm = /^[rR](\d+)$/.exec(t);
      if (rm) r = +rm[1];
      else if (regdef.has(t.toLowerCase())) r = regdef.get(t.toLowerCase());
      else if (/^(\$|0x|0b|\d|'|-)/i.test(t)) {
        throw new CompileError('Hier wird ein Register (r0 … r31) erwartet, keine Zahl "' + t + '". Zahlen erst mit ldi in ein Register laden (z. B. ldi r16, ' + t + ')', line);
      } else {
        const sv = sym.get(t.toLowerCase());
        if (sv) throw new CompileError('"' + t + '" ist kein Register, sondern eine Zahl/Adresse (' + sv.v + ')' + (sv.kind === 'io' ? ' – für I/O-Register braucht man in/out' : ''), line);
        const sg = suggest(t, Array.from(regdef.keys()));
        throw new CompileError('"' + t + '" ist kein Register (r0 … r31)' + (sg ? ' – meintest du "' + sg + '"?' : ' – fehlt ein .def?'), line);
      }
      if (r > 31) throw new CompileError('Register r' + r + ' gibt es nicht (r0 … r31)', line);
      if (min !== undefined && (r < min || r > max)) throw new CompileError((what || 'Dieser Befehl') + ' geht nur mit den Registern r' + min + ' … r' + max + ' (nicht r' + r + ')', line);
      return r;
    };
    const pair = (o, line, allowed, what) => {
      const t = o.trim();
      const pm = /^[rR](\d+)\s*:\s*[rR](\d+)$/.exec(t);
      let r;
      if (pm) { r = +pm[2]; if (+pm[1] !== r + 1) throw new CompileError('Registerpaar ' + t + ' ungültig (z. B. r25:r24)', line); }
      else if (/^[xyzXYZ]$/.test(t)) r = { x: 26, y: 28, z: 30 }[t.toLowerCase()];
      else r = reg(t, line);
      if (!allowed.includes(r)) throw new CompileError(what + ' geht nur mit ' + allowed.map(a => 'r' + (a + 1) + ':r' + a).join(', '), line);
      return r;
    };
    const num = (o, line, min, max, what) => {
      if (o === undefined || o.trim() === '') throw new CompileError((what || 'Wert') + ' fehlt', line);
      const v = evalExpr(o, line);
      if (min !== undefined && (v < min || v > max)) throw new CompileError((what || 'Wert') + ' ' + v + ' liegt außerhalb von ' + min + ' … ' + max, line);
      return v;
    };
    const ioaddr = (o, line, max, mn) => {
      const v = num(o, line, undefined, undefined, 'I/O-Adresse');
      if (v > 0x3F && v >= 0x20 && v <= 0x5F) throw new CompileError('Adresse ' + v + ' ist eine Datenadresse – für ' + mn + ' braucht man die I/O-Adresse (ohne +0x20)', line);
      if (v < 0 || v > max) {
        const nm = IONAME[v] || o.trim();
        if (max === 31) throw new CompileError(mn + ' geht nur mit I/O-Adressen 0 … 31. ' + nm + ' hat Adresse 0x' + v.toString(16).toUpperCase() + ' – benutze in / ori bzw. andi / out', line);
        throw new CompileError('I/O-Adresse ' + v + ' liegt außerhalb von 0 … ' + max, line);
      }
      return v;
    };
    const ptrOp = (o, line, mn) => {
      const t = o.replace(/\s+/g, '').toUpperCase();
      const pm = /^(-?)([XYZ])(\+?)$/.exec(t);
      if (!pm) throw new CompileError(mn + ': Zeiger X, Y oder Z erwartet (auch X+ oder -X), gefunden "' + o.trim() + '"', line);
      if (pm[1] && pm[3]) throw new CompileError('Ungültiger Zeiger "' + o.trim() + '"', line);
      return { p: { X: 26, Y: 28, Z: 30 }[pm[2]], mode: pm[3] ? 1 : pm[1] ? 2 : 0 };
    };
    const dispOp = (o, line, mn) => {
      const t = o.replace(/\s+/g, '');
      const pm = /^([YZyz])\+(.+)$/.exec(t);
      if (!pm) throw new CompileError(mn + ': erwartet Y+q oder Z+q (z. B. Y+2)', line);
      const q = evalExpr(pm[2], line);
      if (q < 0 || q > 63) throw new CompileError(mn + ': Verschiebung ' + q + ' muss zwischen 0 und 63 liegen', line);
      return { p: pm[1].toUpperCase() === 'Y' ? 28 : 30, q };
    };
    const target = (o, line, it, range) => {
      const t = o.trim();
      const lname = t.toLowerCase();
      const wm = /^(wait|warte|delay|pause|wartezeit|sleep|verzoegerung|ms|us)_?(\d+)_?(us|ms|s|sek|sec)?$/i.exec(t) || /^(wait|warte|delay)_?(\d+)(us|ms|s)$/i.exec(t);
      if (!sym.has(lname) && wm) {
        const n = +wm[2]; const unit = (wm[3] || (wm[1].toLowerCase() === 'us' ? 'us' : 'ms')).toLowerCase();
        const sec = unit === 'us' ? n / 1e6 : unit === 'ms' ? n / 1000 : n;
        builtins.set(t, sec);
        warnOnce('bi_' + lname, '"' + t + '" ist nicht im Programm – der Simulator benutzt dafür eine eingebaute Warteschleife (' + (sec >= 1 ? sec + ' s' : sec * 1000 >= 1 ? sec * 1000 + ' ms' : sec * 1e6 + ' µs') + ').', line);
        return { builtin: sec };
      }
      if (!sym.has(lname) && /^(wait|warte|delay|pause)/i.test(t)) {
        throw new CompileError('Label "' + t + '" fehlt. Eingebaute Warteschleifen heißen z. B. Wait10ms, Wait100ms, Wait1s, Wait50us – oder schreibe die Unterroutine selbst.', line);
      }
      const k = evalExpr(t, line);
      const sv = sym.get(lname);
      if (sv && sv.kind === 'label' && sv.seg !== 'c') throw new CompileError('"' + t + '" ist ein Label im Datenspeicher, kein Sprungziel', line);
      const rel = k - (it.addr + 1);
      if (range && (rel < -range || rel >= range)) throw new CompileError('Sprungziel "' + t + '" ist zu weit entfernt (' + rel + ' Wörter, erlaubt ' + -range + ' … ' + (range - 1) + ')' + (range === 64 ? ' – kehre die Bedingung um und benutze rjmp' : ''), line);
      return { k, rel };
    };

    for (const it of items) {
      if (it.kind === 'data') {
        for (let i = 0; i < it.bytes.length; i++) flash[it.addr * 2 + i] = it.bytes[i];
        continue;
      }
      const { mn, line } = it;
      const info = T[mn];
      let ops = splitOps(it.opsText);
      const need = { '-': 0, dr: 2, dr16: 2, dr23: 2, ww: 2, dK: 2, d: 1, d16: 1, wK: 2, k: 1, kl: 1, b: 1, sb: 2, rbit: 2, Abit: 2, dA: 2, Ar: 2, dP: 2, Pr: 2, dQ: 2, Qr: 2, dk16: 2, k16r: 2, s: 1, lpm: -1 }[info.f];
      if (need >= 0 && ops.length !== need) {
        if (ops.length === need - 1 && need === 2) {
          const parts = ops[ops.length - 1].split(/\s+/).filter(Boolean);
          if (parts.length === 2) {
            ops = ops.slice(0, -1).concat(parts);
            warnOnce('comma_' + line, 'Komma fehlt zwischen den Operanden: ' + it.src + ' ' + parts.join(', '), line);
          }
        }
        if (ops.length !== need) {
          throw new CompileError('"' + it.src + '" braucht ' + (need === 0 ? 'keine Operanden' : need === 1 ? '1 Operand' : need + ' Operanden, getrennt durch Komma') + (need === 0 ? '' : ' (' + (EXAMPLE_SYNTAX[mn] || '') + ')'), line);
        }
      }
      const ins = { op: 0, line, addr: it.addr, words: it.words, src: it.src.toLowerCase(), d: 0, r: 0, K: 0, k: 0, b: 0, A: 0, q: 0, p: 0, mode: 0 };
      switch (info.f) {
        case '-':
          if (FLAGOP[mn]) { ins.op = OP[FLAGOP[mn][1] ? 'bset' : 'bclr']; ins.b = FLAGOP[mn][0]; }
          else ins.op = OP[mn];
          break;
        case 'dr':
          ins.d = reg(ops[0], line); ins.r = reg(ops[1], line); ins.op = OP[mn]; break;
        case 'dr16':
          ins.d = reg(ops[0], line, 16, 31, mn); ins.r = reg(ops[1], line, 16, 31, mn); ins.op = OP[mn]; break;
        case 'dr23':
          ins.d = reg(ops[0], line, 16, 23, mn); ins.r = reg(ops[1], line, 16, 23, mn); ins.op = OP[mn]; break;
        case 'ww': {
          const a = pair(ops[0], line, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], 'movw');
          const b = pair(ops[1], line, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], 'movw');
          ins.d = a; ins.r = b; ins.op = OP.movw; break;
        }
        case 'dK': {
          ins.d = reg(ops[0], line, 16, 31, mn);
          let K = num(ops[1], line, undefined, undefined, 'Konstante');
          if (K < -128 || K > 255) throw new CompileError('Konstante ' + K + ' passt nicht in ein Byte (0 … 255)', line);
          K &= 0xFF;
          if (mn === 'sbr') { ins.op = OP.ori; } else if (mn === 'cbr') { ins.op = OP.andi; K = ~K & 0xFF; } else ins.op = OP[mn];
          ins.K = K; break;
        }
        case 'd': {
          ins.d = reg(ops[0], line);
          if (mn === 'tst') { ins.op = OP.and; ins.r = ins.d; }
          else if (mn === 'clr') { ins.op = OP.eor; ins.r = ins.d; }
          else if (mn === 'lsl') { ins.op = OP.add; ins.r = ins.d; }
          else if (mn === 'rol') { ins.op = OP.adc; ins.r = ins.d; }
          else ins.op = OP[mn];
          if (mn === 'push' || mn === 'pop') usesStack = true;
          break;
        }
        case 'd16': ins.d = reg(ops[0], line, 16, 31, mn); ins.op = OP.ldi; ins.K = 0xFF; break;
        case 'wK':
          ins.d = pair(ops[0], line, [24, 26, 28, 30], mn); ins.K = num(ops[1], line, 0, 63, 'Konstante'); ins.op = OP[mn]; break;
        case 'k': {
          const tg = target(ops[0], line, it, 2048);
          if (tg.builtin !== undefined) { ins.op = OP.wait; ins.wait = tg.builtin; ins.name = ops[0].trim(); usesStack = true; break; }
          ins.k = tg.k; ins.rel = tg.rel; ins.op = OP[mn];
          if (mn === 'rcall') usesStack = true;
          if (tg.k >= pc && !items.some(x => x.addr === tg.k)) warn('Sprungziel liegt hinter dem Programmende', line);
          break;
        }
        case 'b': {
          const tg = target(ops[0], line, it, 64);
          ins.k = tg.k; ins.b = BR[mn][0]; ins.op = BR[mn][1] ? OP.brbs : OP.brbc; break;
        }
        case 'sb': {
          ins.b = num(ops[0], line, 0, 7, 'SREG-Bit');
          const tg = target(ops[1], line, it, 64);
          ins.k = tg.k; ins.op = OP[mn]; break;
        }
        case 'rbit': {
          const io0 = sym.get(ops[0].trim().toLowerCase());
          if (io0 && io0.kind === 'io') throw new CompileError(mn + ' prüft ein Bit in einem Register r0 … r31. Für I/O-Register wie ' + ops[0].trim() + ' benutze ' + (mn === 'sbrc' ? 'sbic' : mn === 'sbrs' ? 'sbis' : 'in und dann ' + mn), line);
          ins.d = reg(ops[0], line); ins.b = num(ops[1], line, 0, 7, 'Bitnummer'); ins.op = OP[mn];
          break;
        }
        case 'Abit':
          if (/^[rR]\d+$/.test(ops[0].trim()) || regdef.has(ops[0].trim().toLowerCase())) throw new CompileError(mn + ' arbeitet mit I/O-Registern (z. B. PINC, PORTB). Für r0 … r31 benutze ' + (mn === 'sbic' ? 'sbrc' : mn === 'sbis' ? 'sbrs' : mn === 'sbi' ? 'ori / sbr' : 'andi / cbr'), line);
          ins.A = ioaddr(ops[0], line, 31, mn); ins.b = num(ops[1], line, 0, 7, 'Bitnummer'); ins.op = OP[mn];
          ins.io = IONAME[ins.A];
          break;
        case 'dA':
          ins.d = reg(ops[0], line); ins.A = ioaddr(ops[1], line, 63, 'in'); ins.op = OP.in; ins.io = IONAME[ins.A];
          break;
        case 'Ar':
          if (/^[rR]\d+$/.test(ops[0].trim())) throw new CompileError('out: zuerst die I/O-Adresse, dann das Register – z. B. out PORTB, r16', line);
          ins.A = ioaddr(ops[0], line, 63, 'out'); ins.r = reg(ops[1], line); ins.op = OP.out; ins.io = IONAME[ins.A];
          if (ins.A === 0x3D || ins.A === 0x3E) setsSP = true;
          if (/^\s*\d+\s*$/.test(ops[1])) throw new CompileError('out geht nur mit einem Register: erst ldi r16, Wert und dann out ' + ops[0].trim() + ', r16', line);
          break;
        case 'dP': { ins.d = reg(ops[0], line); const pp = ptrOp(ops[1], line, 'ld'); ins.p = pp.p; ins.mode = pp.mode; ins.op = OP.ld; break; }
        case 'Pr': { const pp = ptrOp(ops[0], line, 'st'); ins.p = pp.p; ins.mode = pp.mode; ins.r = reg(ops[1], line); ins.op = OP.st; break; }
        case 'dQ': { ins.d = reg(ops[0], line); const pp = dispOp(ops[1], line, 'ldd'); ins.p = pp.p; ins.q = pp.q; ins.mode = 3; ins.op = OP.ld; break; }
        case 'Qr': { const pp = dispOp(ops[0], line, 'std'); ins.p = pp.p; ins.q = pp.q; ins.mode = 3; ins.r = reg(ops[1], line); ins.op = OP.st; break; }
        case 'dk16': {
          ins.d = reg(ops[0], line); ins.k = num(ops[1], line, 0, 0xFFFF, 'Adresse'); ins.op = OP.lds;
          const sv = sym.get(ops[1].trim().toLowerCase());
          if (sv && sv.kind === 'io') warn(ops[1].trim() + ' ist eine I/O-Adresse – lds braucht die Datenadresse (' + ops[1].trim() + '+0x20) oder besser: in', line);
          break;
        }
        case 'k16r': {
          ins.k = num(ops[0], line, 0, 0xFFFF, 'Adresse'); ins.r = reg(ops[1], line); ins.op = OP.sts;
          const sv = sym.get(ops[0].trim().toLowerCase());
          if (sv && sv.kind === 'io') warn(ops[0].trim() + ' ist eine I/O-Adresse – sts braucht die Datenadresse (' + ops[0].trim() + '+0x20) oder besser: out', line);
          break;
        }
        case 'lpm':
          ins.op = OP.lpm;
          if (!ops.length || (ops.length === 1 && !ops[0])) { ins.d = 0; ins.mode = 0; }
          else if (ops.length === 2) {
            ins.d = reg(ops[0], line);
            const t = ops[1].replace(/\s+/g, '').toUpperCase();
            if (t === 'Z') ins.mode = 0; else if (t === 'Z+') ins.mode = 1;
            else throw new CompileError('lpm: zweiter Operand muss Z oder Z+ sein', line);
          } else throw new CompileError('lpm: "lpm" oder "lpm r16, Z" oder "lpm r16, Z+"', line);
          break;
        case 's': ins.b = num(ops[0], line, 0, 7, 'SREG-Bit'); ins.op = OP[mn]; break;
        default: throw new CompileError('Interner Fehler: Format ' + info.f, line);
      }
      ins.c = info.c;
      code[it.addr] = ins;
    }

    // Hinweise
    const main = code[0];
    if (!main && items.length) warn('An Adresse 0 (Reset) steht kein Befehl – der Chip beginnt dort nach dem Einschalten.', 1);
    const sp = new Map();
    for (const [, v] of sym) if (v.kind === 'label' && v.seg === 'c') { if (!sp.has(v.v)) sp.set(v.v, v.name); }
    const varLabels = [];
    for (const [, v] of sym) if (v.kind === 'label' && v.seg === 'd') varLabels.push({ name: v.name, addr: v.v });
    varLabels.sort((a, b) => a.addr - b.addr);
    const defs = new Map();
    for (const [n, r] of regdef) if (!['xl', 'xh', 'yl', 'yh', 'zl', 'zh'].includes(n)) defs.set(r, (defs.get(r) ? defs.get(r) + ', ' : '') + n);

    return {
      lang: 'asm', code, flash, warnings: warnings.sort((a, b) => a.line - b.line), fcpu, delayFcpu: null,
      words: pc, dseg: dpc - 0x60, labels: sp, varLabels, defs, usesStack, setsSP, orgAddrs, builtins,
      isrs: new Map(), globals: [], statics: [], ram: dpc - 0x60,
    };
  }
  const EXAMPLE_SYNTAX = {
    ldi: 'ldi r16, 0b00001111', out: 'out PORTB, r16', in: 'in r16, PINC', sbic: 'sbic PINC, 0', sbis: 'sbis PINC, 0', sbi: 'sbi PORTB, 0', cbi: 'cbi PORTB, 0',
    sbrc: 'sbrc r19, 0', sbrs: 'sbrs r19, 0', mov: 'mov r16, r17', add: 'add r16, r17', cpi: 'cpi r19, 0', andi: 'andi r16, 0x0F', ori: 'ori r16, 0x01',
    subi: 'subi r16, 1', rjmp: 'rjmp loop', rcall: 'rcall unterprogramm', breq: 'breq ziel', brne: 'brne ziel', inc: 'inc r16', dec: 'dec r16', lsl: 'lsl r19',
    push: 'push r16', pop: 'pop r16', ld: 'ld r16, Z+', st: 'st X+, r16', lds: 'lds r16, variable', sts: 'sts variable, r16', adiw: 'adiw r24, 1', sbiw: 'sbiw r24, 1',
  };

  // =====================================================================
  // Prozessor
  // =====================================================================
  const DELAY = G.AvrVM.DELAY;

  class AsmVM {
    constructor(prog, mcu, opts) {
      this.prog = prog; this.mcu = mcu; this.opts = opts || {};
      this.clock = this.opts.clock || 1e6;
      this.reset();
    }
    reset() {
      const mcu = this.mcu;
      mcu.reset();
      this.R = new Uint8Array(32);
      this.ram = new Uint8Array(1024);
      this.pc = 0; this.sp = 0x45F;
      this.halted = false; this.finished = false;
      this.pend = null; this.cur = null;
      this.horizon = Infinity;
      this.waitEnd = null; this.irqFrames = []; this.irqHold = false; this.sleeping = false;
      this.isrCount = new Array(AVR.VECTORS.length).fill(0);
      this.calls = [];
      this.res = { done: false, value: null };
      this.gen = this;
      this.spWarned = false;
      this.changed = new Set();
    }
    get cycles() { return this.mcu.cycles; }
    get line() { return this.cur ? this.cur.line : 0; }
    frames() { return []; }

    // ---------- Speicher ----------
    ioRead(a) {
      if (a === 0x3D) return this.sp & 0xFF;
      if (a === 0x3E) return (this.sp >> 8) & 0xFF;
      if (a === 0x3F) return this.mcu.sreg;
      const n = IONAME[a];
      return n ? this.mcu.read(n) & 0xFF : 0;
    }
    ioWrite(a, v) {
      if (a === 0x3D) { this.sp = (this.sp & 0xFF00) | v; this.spSet = true; return; }
      if (a === 0x3E) { this.sp = (this.sp & 0x00FF) | ((v & 0x07) << 8); this.spSet = true; return; }
      if (a === 0x3F) { this.mcu.sreg = v; this.mcu.updateIrq(); this.irqHold = true; return; }
      let n = IONAME[a];
      if (a === 0x20) n = (v & 0x80) ? 'UCSRC' : 'UBRRH';
      if (n) this.mcu.write(n, v);
    }
    dread(a) {
      if (a < 32) return this.R[a];
      if (a < 0x60) return this.ioRead(a - 0x20);
      if (a < 0x460) return this.ram[a - 0x60];
      throw new RuntimeError('Lesezugriff auf Adresse 0x' + a.toString(16).toUpperCase() + ' – die liegt außerhalb des SRAM (0x60 … 0x45F)');
    }
    dwrite(a, v) {
      if (a < 32) { this.R[a] = v; return; }
      if (a < 0x60) { this.ioWrite(a - 0x20, v); return; }
      if (a < 0x460) { this.ram[a - 0x60] = v; return; }
      throw new RuntimeError('Schreibzugriff auf Adresse 0x' + a.toString(16).toUpperCase() + ' – die liegt außerhalb des SRAM (0x60 … 0x45F)');
    }
    push(v) {
      if (this.sp < 0x60) throw new RuntimeError('Stapelüberlauf: Der Stackpointer zeigt auf 0x' + this.sp.toString(16).toUpperCase() + ' (unterhalb des SRAM). Zu viele push/rcall ohne pop/ret?');
      this.ram[this.sp - 0x60] = v & 0xFF; this.sp--;
    }
    pop() {
      if (this.sp >= 0x45F) throw new RuntimeError('Stack ist leer: ret/pop ohne vorheriges rcall/push. (Wurde ein Unterprogramm mit rjmp statt rcall angesprungen?)');
      this.sp++; return this.ram[this.sp - 0x60];
    }
    pushPC(v) { this.push(v & 0xFF); this.push(v >> 8); }
    popPC() { const h = this.pop(); const l = this.pop(); return (h << 8) | l; }

    // ---------- Iterator für die Hauptschleife ----------
    next() {
      const R = this.res;
      const mcu = this.mcu;
      if (this.pend) { const p = this.pend; this.pend = null; this.exec(p); }
      if (this.halted) { R.done = true; R.value = null; return R; }
      // eingebaute Warteschleife oder sleep
      if (this.waitEnd !== null || this.sleeping) {
        if (this.waitEnd !== null && mcu.cycles >= this.waitEnd) { this.waitEnd = null; }
        else if (mcu.irq && !this.irqHold) { /* Interrupt unterbricht das Warten */ }
        else {
          let next = this.waitEnd !== null ? this.waitEnd : Infinity;
          if (this.horizon < next) next = this.horizon;
          if (mcu.busy) { const ne = mcu.nextEvent(); if (ne < next) next = ne; }
          if (next === Infinity) {
            if (this.sleeping) throw new RuntimeError('sleep: Der Chip schläft für immer – es ist kein Interrupt eingeschaltet, der ihn wecken könnte.');
          } else if (next > mcu.cycles) mcu.advance(next - mcu.cycles);
          this.irqHold = false;
          R.value = DELAY; return R;
        }
      }
      if (mcu.irq && !this.irqHold) this.interrupt();
      this.irqHold = false;
      const ins = this.prog.code[this.pc];
      if (!ins) {
        if (this.pc >= this.prog.words) throw new RuntimeError('Das Programm ist über sein Ende hinausgelaufen (Adresse 0x' + this.pc.toString(16).toUpperCase() + '). Am Ende fehlt eine Endlosschleife, z. B. "ende: rjmp ende".');
        throw new RuntimeError('An Adresse 0x' + this.pc.toString(16).toUpperCase() + ' steht kein Befehl (nur Daten oder leer).');
      }
      this.pend = ins;
      this.cur = ins;
      R.value = ins;
      return R;
    }

    interrupt() {
      const mcu = this.mcu;
      const v = mcu.pending();
      if (v < 0) { mcu.updateIrq(); return; }
      const addr = v + 1;
      const name = AVR.VECTORS[v];
      if (!this.prog.code[addr]) throw new RuntimeError('Interrupt ' + name + ' ist freigegeben, aber an seiner Vektor-Adresse 0x' + addr.toString(16).toUpperCase() + ' steht kein Befehl. Fehlt ".org ' + vecLabel(v) + '" mit "rjmp isr_…"?');
      if (!this.prog.orgAddrs.has(addr) && !this.warnedVec) {
        this.warnedVec = true;
        if (this.opts.onWarn) this.opts.onWarn('Interrupt ' + name + ' springt an Adresse 0x' + addr.toString(16).toUpperCase() + ' – dort steht keine Interrupt-Tabelle (.org ' + vecLabel(v) + ' / rjmp …). Der Chip führt einfach den Befehl aus, der dort steht!');
      }
      mcu.ack(v);
      this.irqFrames.push(this.waitEnd);
      this.waitEnd = null; this.sleeping = false;
      this.pushPC(this.pc);
      mcu.sreg &= ~0x80; mcu.updateIrq();
      this.pc = addr;
      this.isrCount[v]++;
      mcu.advance(4);
    }

    skipNext() {
      const nx = this.prog.code[this.pc + 1];
      const w = nx ? nx.words : 1;
      this.pc += 1 + w;
      this.mcu.advance(1 + w);
    }

    // ---------- Befehl ausführen ----------
    exec(ins) {
      const R = this.R, mcu = this.mcu;
      let s = mcu.sreg;
      const d = ins.d, r = ins.r;
      let res, a, b, c;
      switch (ins.op) {
        case 0: case 1: { // add, adc
          a = R[d]; b = R[r]; c = ins.op === 1 ? (s & 1) : 0;
          res = (a + b + c) & 0xFF;
          s = flagsAdd(s, a, b, res, a + b + c > 255);
          R[d] = res; break;
        }
        case 2: case 3: case 7: case 8: { // sub, sbc, cp, cpc
          a = R[d]; b = R[r]; c = (ins.op === 3 || ins.op === 8) ? (s & 1) : 0;
          res = (a - b - c) & 0xFF;
          s = flagsSub(s, a, b, res, a < b + c, ins.op === 3 || ins.op === 8);
          if (ins.op < 4) R[d] = res; break;
        }
        case 4: R[d] &= R[r]; s = flagsLogic(s, R[d]); break;
        case 5: R[d] |= R[r]; s = flagsLogic(s, R[d]); break;
        case 6: R[d] ^= R[r]; s = flagsLogic(s, R[d]); break;
        case 9: // cpse
          if (R[d] === R[r]) { this.skipNext(); mcu.sreg = s; return; }
          break;
        case 10: R[d] = R[r]; break;
        case 11: case 12: case 13: case 14: case 15: case 16: { // mul…
          let x = R[d], y = R[r];
          if (ins.op === 12 || ins.op === 15) { x = (x << 24) >> 24; y = (y << 24) >> 24; }
          else if (ins.op === 13 || ins.op === 16) { x = (x << 24) >> 24; }
          let p = x * y;
          const cbit = (p >> 15) & 1;
          if (ins.op >= 14) p = p << 1;
          p &= 0xFFFF;
          R[0] = p & 0xFF; R[1] = p >> 8;
          s = (s & ~0x03) | (cbit ? 1 : 0) | (p === 0 ? 2 : 0);
          break;
        }
        case 17: R[d] = R[r]; R[d + 1] = R[r + 1]; break; // movw
        case 18: R[d] = ins.K; break; // ldi
        case 19: case 20: case 21: { // cpi, subi, sbci
          a = R[d]; b = ins.K; c = ins.op === 21 ? (s & 1) : 0;
          res = (a - b - c) & 0xFF;
          s = flagsSub(s, a, b, res, a < b + c, ins.op === 21);
          if (ins.op !== 19) R[d] = res; break;
        }
        case 22: R[d] &= ins.K; s = flagsLogic(s, R[d]); break;
        case 23: R[d] |= ins.K; s = flagsLogic(s, R[d]); break;
        case 24: R[d] = (~R[d]) & 0xFF; s = flagsLogic(s, R[d]) | 1; break; // com
        case 25: { // neg
          a = R[d]; res = (-a) & 0xFF; R[d] = res;
          s = flagsSub(s, 0, a, res, a !== 0, false); break;
        }
        case 26: { // inc
          res = (R[d] + 1) & 0xFF; const v = res === 0x80;
          s = (s & ~0x1E) | (v ? 8 : 0) | ((res & 0x80) ? 4 : 0) | (res === 0 ? 2 : 0);
          s |= ((((s >> 2) ^ (s >> 3)) & 1) << 4); R[d] = res; break;
        }
        case 27: { // dec
          res = (R[d] - 1) & 0xFF; const v = res === 0x7F;
          s = (s & ~0x1E) | (v ? 8 : 0) | ((res & 0x80) ? 4 : 0) | (res === 0 ? 2 : 0);
          s |= ((((s >> 2) ^ (s >> 3)) & 1) << 4); R[d] = res; break;
        }
        case 28: case 29: case 30: { // lsr, ror, asr
          a = R[d]; const cb = a & 1;
          if (ins.op === 28) res = a >> 1;
          else if (ins.op === 29) res = (a >> 1) | ((s & 1) << 7);
          else res = (a >> 1) | (a & 0x80);
          R[d] = res;
          const n = (res >> 7) & 1, v = n ^ cb;
          s = (s & ~0x1F) | cb | (res === 0 ? 2 : 0) | (n << 2) | (v << 3) | ((n ^ v) << 4);
          break;
        }
        case 31: R[d] = ((R[d] << 4) | (R[d] >> 4)) & 0xFF; break; // swap
        case 32: this.push(R[d]); this.checkSP(); break;
        case 33: R[d] = this.pop(); break;
        case 34: case 35: { // adiw, sbiw
          const w = R[d] | (R[d + 1] << 8);
          const rr = ins.op === 34 ? (w + ins.K) & 0xFFFF : (w - ins.K) & 0xFFFF;
          R[d] = rr & 0xFF; R[d + 1] = rr >> 8;
          const n = (rr >> 15) & 1;
          const v = ins.op === 34 ? (!(w & 0x8000) && (rr & 0x8000)) : ((w & 0x8000) && !(rr & 0x8000));
          const cc = ins.op === 34 ? (!(rr & 0x8000) && (w & 0x8000)) : ((rr & 0x8000) && !(w & 0x8000));
          s = (s & ~0x1F) | (cc ? 1 : 0) | (rr === 0 ? 2 : 0) | (n << 2) | (v ? 8 : 0) | (((n ^ (v ? 1 : 0))) << 4);
          break;
        }
        case 36: // rjmp
          if (ins.rel === -1) { this.idle(ins); mcu.sreg = s; return; }
          this.pc = ins.k; mcu.advance(2); mcu.sreg = s; return;
        case 37: // rcall
          this.pushPC(this.pc + 1); this.checkSP(); this.calls.push(ins.k);
          this.pc = ins.k; mcu.advance(3); mcu.sreg = s; return;
        case 38: this.pc = R[30] | (R[31] << 8); mcu.advance(2); return;
        case 39: this.pushPC(this.pc + 1); this.checkSP(); this.pc = R[30] | (R[31] << 8); mcu.advance(3); return;
        case 40: case 41: { // ret, reti
          this.pc = this.popPC(); this.calls.pop();
          if (ins.op === 41) {
            mcu.sreg |= 0x80; mcu.updateIrq(); this.irqHold = true;
            if (this.irqFrames.length) { const w = this.irqFrames.pop(); if (w !== null && w !== undefined) this.waitEnd = w; }
          }
          mcu.advance(4); return;
        }
        case 42: case 44: break; // nop, wdr
        case 43: this.sleeping = true; break; // sleep
        case 45: case 46: { // brbs, brbc
          const bit = (s >> ins.b) & 1;
          if ((ins.op === 45) === (bit === 1)) { this.pc = ins.k; mcu.advance(2); return; }
          break;
        }
        case 47: case 48: { // sbrc, sbrs
          const bit = (R[d] >> ins.b) & 1;
          if ((ins.op === 47 && !bit) || (ins.op === 48 && bit)) { this.skipNext(); return; }
          break;
        }
        case 49: s = (s & ~0x40) | (((R[d] >> ins.b) & 1) << 6); break; // bst
        case 50: R[d] = (R[d] & ~(1 << ins.b)) | (((s >> 6) & 1) << ins.b); break; // bld
        case 51: case 52: { // sbic, sbis
          const bit = (this.ioRead(ins.A) >> ins.b) & 1;
          if ((ins.op === 51 && !bit) || (ins.op === 52 && bit)) { this.skipNext(); return; }
          break;
        }
        case 53: this.ioWrite(ins.A, this.ioRead(ins.A) | (1 << ins.b)); break; // sbi
        case 54: this.ioWrite(ins.A, this.ioRead(ins.A) & ~(1 << ins.b)); break; // cbi
        case 55: R[d] = this.ioRead(ins.A); break; // in
        case 56: this.ioWrite(ins.A, R[r]); if (ins.A === 0x3F) s = mcu.sreg; break; // out
        case 57: case 58: { // ld, st
          const p = ins.p;
          let addr = R[p] | (R[p + 1] << 8);
          if (ins.mode === 2) { addr = (addr - 1) & 0xFFFF; R[p] = addr & 0xFF; R[p + 1] = addr >> 8; }
          const ea = ins.mode === 3 ? addr + ins.q : addr;
          if (ins.op === 57) R[d] = this.dread(ea); else this.dwrite(ea, R[r]);
          if (ins.mode === 1) { const n2 = (addr + 1) & 0xFFFF; R[p] = n2 & 0xFF; R[p + 1] = n2 >> 8; }
          if (ins.op === 58 && ea >= 0x20 && ea < 0x60) s = mcu.sreg;
          break;
        }
        case 59: R[d] = this.dread(ins.k); break; // lds
        case 60: this.dwrite(ins.k, R[r]); if (ins.k === 0x5F) s = mcu.sreg; break; // sts
        case 61: { // lpm
          const z = R[30] | (R[31] << 8);
          if (z >= 8192) throw new RuntimeError('lpm: Z = 0x' + z.toString(16) + ' liegt außerhalb des Flash (8 KB). Tipp: ldi ZL, LOW(tabelle*2) / ldi ZH, HIGH(tabelle*2)');
          R[d] = this.prog.flash[z];
          if (ins.mode === 1) { const n2 = z + 1; R[30] = n2 & 0xFF; R[31] = n2 >> 8; }
          break;
        }
        case 62: s |= (1 << ins.b); if (ins.b === 7) { mcu.sreg = s; mcu.updateIrq(); this.irqHold = true; } break; // bset
        case 63: s &= ~(1 << ins.b); if (ins.b === 7) { mcu.sreg = s; mcu.updateIrq(); } break; // bclr
        case 64: { // eingebaute Warteschleife (rcall WaitXms)
          this.waitEnd = mcu.cycles + Math.round(ins.wait * this.clock);
          this.pc += 1; mcu.advance(7); mcu.sreg = s; return;
        }
        case 65: break; // spm
      }
      mcu.sreg = s;
      this.pc += ins.words;
      mcu.advance(ins.c);
    }

    checkSP() {
      if (!this.spSet && !this.spWarned && !this.prog.setsSP) {
        this.spWarned = true;
        if (this.opts.onTip) this.opts.onTip('Hinweis: Der Stackpointer wird im Programm nicht gesetzt. Beim echten ATmega8 steht er nach dem Reset auf 0 – rcall/push funktionieren dann nicht zuverlässig. Setze ihn am Anfang: ldi r16, HIGH(RAMEND) / out SPH, r16 / ldi r16, LOW(RAMEND) / out SPL, r16. (Der Simulator setzt ihn automatisch.)');
      }
    }

    // "loop: rjmp loop" -> bis zum nächsten Ereignis vorspulen
    idle(ins) {
      const mcu = this.mcu;
      let next = this.horizon;
      if (mcu.busy) { const ne = mcu.nextEvent(); if (ne < next) next = ne; }
      if (next !== Infinity && next > mcu.cycles + 2) mcu.advance(Math.ceil((next - mcu.cycles) / 2) * 2);
      else mcu.advance(2);
    }
  }

  function vecLabel(v) { return Object.keys(VEC_ADDR).find(k => VEC_ADDR[k] === v + 1) || '0x' + (v + 1).toString(16); }

  function flagsAdd(s, a, b, r, carry) {
    const hh = (((a & b) | (b & ~r) | (~r & a)) >> 3) & 1;
    const v = (((a & b & ~r) | (~a & ~b & r)) >> 7) & 1;
    const n = (r >> 7) & 1;
    return (s & 0xC0) | (carry ? 1 : 0) | (r === 0 ? 2 : 0) | (n << 2) | (v << 3) | ((n ^ v) << 4) | (hh << 5);
  }
  function flagsSub(s, a, b, r, borrow, keepZ) {
    const hh = (((~a & b) | (b & r) | (r & ~a)) >> 3) & 1;
    const v = (((a & ~b & ~r) | (~a & b & r)) >> 7) & 1;
    const n = (r >> 7) & 1;
    const z = keepZ ? ((r === 0 && (s & 2)) ? 2 : 0) : (r === 0 ? 2 : 0);
    return (s & 0xC0) | (borrow ? 1 : 0) | z | (n << 2) | (v << 3) | ((n ^ v) << 4) | (hh << 5);
  }
  function flagsLogic(s, r) {
    const n = (r >> 7) & 1;
    return (s & ~0x1E) | (r === 0 ? 2 : 0) | (n << 2) | (n << 4);
  }

  AsmVM.IONAME = IONAME;
  G.AvrAsm = { assemble, AsmVM, IO, IONAME, MNEMONICS: Object.keys(T) };
})(typeof window !== 'undefined' ? window : globalThis);
