/* C-Compiler für den ATmega8-Simulator
 * Präprozessor -> Lexer -> Parser (AST) -> Typprüfung/Auflösung.
 * Unterstützt die C-Teilmenge, die man im Unterricht mit avr-gcc braucht.
 * Typgrößen wie beim AVR: char 8 Bit, int 16 Bit, long 32 Bit, float/double 32 Bit.
 */
(function (G) {
  'use strict';
  const AVR = G.ATmega8;

  class CompileError extends Error {
    constructor(msg, line, col) { super(msg); this.line = line || 0; this.col = col || 0; }
  }

  // =====================================================================
  // Typen
  // =====================================================================
  function mkInt(bits, s, name) { return { k: 'int', bits, s, name }; }
  const TY = {
    void: { k: 'void', name: 'void' },
    bool: { k: 'bool', bits: 8, s: false, name: 'bool' },
    i8: mkInt(8, true, 'char'), u8: mkInt(8, false, 'uint8_t'),
    i16: mkInt(16, true, 'int'), u16: mkInt(16, false, 'unsigned int'),
    i32: mkInt(32, true, 'long'), u32: mkInt(32, false, 'unsigned long'),
    f32: { k: 'float', name: 'float' },
  };
  const ptrT = to => ({ k: 'ptr', to, name: typeName(to) + ' *' });
  const arrT = (of, n) => ({ k: 'arr', of, n, name: typeName(of) + '[' + (n == null ? '' : n) + ']' });
  function typeName(t) { return t ? t.name : '?'; }
  const isInt = t => t.k === 'int' || t.k === 'bool';
  const isArith = t => isInt(t) || t.k === 'float';
  const isPtrLike = t => t.k === 'ptr' || t.k === 'arr';
  function sizeOf(t) {
    switch (t.k) {
      case 'int': return t.bits / 8; case 'bool': return 1; case 'float': return 4;
      case 'ptr': return 2; case 'arr': return (t.n || 0) * sizeOf(t.of); default: return 1;
    }
  }
  function cells(t) { return t.k === 'arr' ? (t.n || 0) * cells(t.of) : 1; }
  function scalarBase(t) { while (t.k === 'arr') t = t.of; return t; }
  function promote(t) { return (t.k === 'bool' || (t.k === 'int' && t.bits < 16)) ? TY.i16 : t; }
  function usual(a, b) {
    if (a.k === 'float' || b.k === 'float') return TY.f32;
    a = promote(a); b = promote(b);
    if (a.bits !== b.bits) return a.bits > b.bits ? a : b;
    return a.s ? b : a;
  }
  function decay(t) { return t.k === 'arr' ? ptrT(t.of) : t; }

  // Umwandlungsfunktion in einen Typ (Abschneiden auf Bitbreite)
  const W = {
    u8: v => v & 0xFF, i8: v => (v << 24) >> 24,
    u16: v => v & 0xFFFF, i16: v => (v << 16) >> 16,
    u32: v => v >>> 0, i32: v => v | 0,
    f: v => Math.fround(+v), b: v => (v !== 0 && v !== null && v !== undefined) ? 1 : 0,
    id: v => v,
    p: v => (v === 0 ? null : v),
  };
  function wrapOf(t) {
    switch (t.k) {
      case 'int': return t.bits === 8 ? (t.s ? W.i8 : W.u8) : t.bits === 16 ? (t.s ? W.i16 : W.u16) : (t.s ? W.i32 : W.u32);
      case 'bool': return W.b;
      case 'float': return W.f;
      case 'ptr': return W.p;
      default: return W.id;
    }
  }

  // =====================================================================
  // Lexer
  // =====================================================================
  const PUNCT = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##',
    '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#'];
  const reNum = /(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)([uUlLfF]*)/y;
  const reId = /[A-Za-z_]\w*/y;

  function parseEscape(s, i, line) {
    // s[i] ist das Zeichen nach '\'
    const c = s[i];
    const simple = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };
    if (c === 'x') {
      const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1));
      if (!m) throw new CompileError('Ungültige Escape-Sequenz \\x', line);
      return [parseInt(m[0], 16), i + 1 + m[0].length];
    }
    if (/[0-7]/.test(c)) {
      const m = /^[0-7]{1,3}/.exec(s.slice(i));
      return [parseInt(m[0], 8) & 0xFF, i + m[0].length];
    }
    if (c in simple) return [simple[c], i + 1];
    return [c.charCodeAt(0), i + 1];
  }

  function numToken(text, suf, line, col) {
    const lower = text.toLowerCase();
    const isHex = lower.startsWith('0x'), isBin = lower.startsWith('0b');
    const isFloat = !isHex && !isBin && (/[.e]/.test(lower) || /f/i.test(suf));
    if (isFloat) return { t: 'num', v: Math.fround(parseFloat(text)), ty: TY.f32, line, col, s: text + suf };
    if (/f/i.test(suf)) throw new CompileError('Ungültiges Zahlen-Suffix "' + suf + '"', line, col);
    let v;
    if (isHex) v = parseInt(text.slice(2), 16);
    else if (isBin) v = parseInt(text.slice(2), 2);
    else if (text.length > 1 && text[0] === '0') {
      if (/[89]/.test(text)) throw new CompileError('Ungültige Oktalzahl "' + text + '" (führende 0 bedeutet Oktal!)', line, col);
      v = parseInt(text, 8);
    } else v = parseInt(text, 10);
    const u = /u/i.test(suf), l = (suf.match(/l/gi) || []).length;
    let cands;
    const dec = !isHex && !isBin && !(text.length > 1 && text[0] === '0');
    if (u && l) cands = [TY.u32];
    else if (u) cands = [TY.u16, TY.u32];
    else if (l) cands = dec ? [TY.i32, TY.u32] : [TY.i32, TY.u32];
    else cands = dec ? [TY.i16, TY.i32, TY.u32] : [TY.i16, TY.u16, TY.i32, TY.u32];
    let ty = null;
    for (const c of cands) {
      const max = c.s ? Math.pow(2, c.bits - 1) - 1 : Math.pow(2, c.bits) - 1;
      if (v <= max) { ty = c; break; }
    }
    if (!ty) throw new CompileError('Zahl ' + text + ' ist zu groß (maximal 32 Bit)', line, col);
    return { t: 'num', v, ty, line, col, s: text + suf };
  }

  function lex(text, line0) {
    const toks = [];
    let i = 0, line = line0 || 1, lineStart = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === '\n') { line++; i++; lineStart = i; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
      const col = i - lineStart + 1;
      if ((c >= '0' && c <= '9') || (c === '.' && text[i + 1] >= '0' && text[i + 1] <= '9')) {
        reNum.lastIndex = i;
        const m = reNum.exec(text);
        toks.push(numToken(m[1], m[2], line, col));
        i += m[0].length;
        if (/[A-Za-z_]/.test(text[i] || '')) throw new CompileError('Ungültige Zahl "' + m[0] + text[i] + '…"', line, col);
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        reId.lastIndex = i;
        const m = reId.exec(text);
        toks.push({ t: 'id', v: m[0], line, col });
        i += m[0].length;
        continue;
      }
      if (c === "'") {
        let j = i + 1, v;
        if (text[j] === '\\') { [v, j] = parseEscape(text, j + 1, line); }
        else if (text[j] === "'" || text[j] === '\n' || j >= n) throw new CompileError('Leeres Zeichen-Literal \'\'', line, col);
        else { v = text.charCodeAt(j); j++; }
        if (text[j] !== "'") throw new CompileError('Zeichen-Literal nicht geschlossen (fehlendes \')', line, col);
        toks.push({ t: 'num', v: v > 127 ? v - 256 : v, ty: TY.i16, line, col, s: text.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
      if (c === '"') {
        let j = i + 1; const chars = [];
        while (j < n && text[j] !== '"') {
          if (text[j] === '\n') throw new CompileError('Zeichenkette nicht geschlossen (fehlendes ")', line, col);
          if (text[j] === '\\') { let v; [v, j] = parseEscape(text, j + 1, line); chars.push(v); }
          else { chars.push(text.charCodeAt(j) & 0xFF); j++; }
        }
        if (j >= n) throw new CompileError('Zeichenkette nicht geschlossen (fehlendes ")', line, col);
        toks.push({ t: 'str', v: chars, line, col, s: text.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
      let p = null;
      for (const q of PUNCT) if (text.startsWith(q, i)) { p = q; break; }
      if (!p) throw new CompileError('Unerwartetes Zeichen "' + c + '"', line, col);
      toks.push({ t: 'op', v: p, line, col });
      i += p.length;
    }
    return toks;
  }

  // =====================================================================
  // Präprozessor
  // =====================================================================
  function stripComments(src) {
    let out = '', i = 0;
    const n = src.length;
    let unclosed = 0;
    while (i < n) {
      const c = src[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        out += src.slice(i, j + 1); i = j + 1; continue;
      }
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') { if (src[i] === '\\' && src[i + 1] === '\n') { out += '\n'; i += 2; continue; } i++; }
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const start = i;
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? n : end + 2;
        if (end < 0) unclosed = src.slice(0, start).split('\n').length;
        out += ' ' + src.slice(start, stop).replace(/[^\n]/g, '').replace(/\n/g, '\n');
        i = stop; continue;
      }
      out += c; i++;
    }
    if (unclosed) throw new CompileError('Kommentar /* wurde nicht mit */ geschlossen', unclosed);
    return out;
  }

  const KNOWN_HEADERS = new Set(['avr/io.h', 'util/delay.h', 'avr/interrupt.h', 'stdint.h', 'stdbool.h', 'avr/pgmspace.h',
    'stdlib.h', 'inttypes.h', 'string.h', 'avr/cpufunc.h', 'avr/wdt.h', 'avr/sfr_defs.h', 'math.h', 'stdio.h', 'compat/deprecated.h', 'avr/sleep.h']);

  function defineSimple(macros, name, bodyText, params) {
    macros.set(name, { params: params || null, body: lex(bodyText, 0), builtin: true });
  }

  function preprocess(src, ctx) {
    const lines = stripComments(src).split('\n');
    const out = [];
    const macros = ctx.macros;
    const stack = [];
    let active = true;

    const evalIf = (text, line) => {
      let toks = lex(text, line);
      const r = [];
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (t.t === 'id' && t.v === 'defined') {
          let name;
          if (toks[k + 1] && toks[k + 1].v === '(') { name = toks[k + 2] && toks[k + 2].v; k += 3; }
          else { name = toks[k + 1] && toks[k + 1].v; k += 1; }
          r.push({ t: 'num', v: macros.has(name) ? 1 : 0, ty: TY.i16, line });
        } else r.push(t);
      }
      toks = expand(r, macros).map(t => t.t === 'id' ? { t: 'num', v: 0, ty: TY.i32, line } : t);
      const p = new Parser(toks, ctx);
      const e = p.parseExpr();
      return p.constEval(e) !== 0;
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const lineNo = i + 1;
      let extra = 0;
      while (/\\\s*$/.test(line) && i + 1 < lines.length) { line = line.replace(/\\\s*$/, ' ') + lines[++i]; extra++; }
      const m = /^\s*#\s*(\w*)\s*(.*)$/.exec(line);
      if (m) {
        const dir = m[1], rest = m[2].trim();
        switch (dir) {
          case 'ifdef': case 'ifndef': {
            const name = rest.split(/\s+/)[0];
            const val = macros.has(name) === (dir === 'ifdef');
            stack.push({ parent: active, taken: val, line: lineNo });
            active = active && val;
            break;
          }
          case 'if': {
            const val = active ? evalIf(rest, lineNo) : false;
            stack.push({ parent: active, taken: val, line: lineNo });
            active = active && val;
            break;
          }
          case 'elif': {
            const top = stack[stack.length - 1];
            if (!top) throw new CompileError('#elif ohne #if', lineNo);
            if (top.taken) active = false;
            else { const val = top.parent ? evalIf(rest, lineNo) : false; top.taken = val; active = top.parent && val; }
            break;
          }
          case 'else': {
            const top = stack[stack.length - 1];
            if (!top) throw new CompileError('#else ohne #if', lineNo);
            active = top.parent && !top.taken; top.taken = true;
            break;
          }
          case 'endif': {
            const top = stack.pop();
            if (!top) throw new CompileError('#endif ohne #if', lineNo);
            active = top.parent;
            break;
          }
          default:
            if (!active) break;
            switch (dir) {
              case 'include': {
                const mm = /^[<"]([^>"]+)[>"]/.exec(rest);
                if (!mm) throw new CompileError('#include: Dateiname in <...> oder "..." erwartet', lineNo);
                const h = mm[1].trim();
                ctx.includes.add(h);
                if (!KNOWN_HEADERS.has(h)) {
                  ctx.warn((rest[0] === '"' ? 'Eigene Datei "' + h + '" gibt es im Simulator nicht – ' : 'Header <' + h + '> ist im Simulator nicht vorhanden – ') + 'wird ignoriert.', lineNo);
                }
                if (h === 'avr/io.h' && !ctx.ioDefined) {
                  ctx.ioDefined = true;
                  for (const [k, v] of Object.entries(AVR.BITS)) defineSimple(macros, k, String(v));
                  defineSimple(macros, '_BV', '(1 << (bit))', ['bit']);
                  defineSimple(macros, 'bit_is_set', '((sfr) & _BV(bit))', ['sfr', 'bit']);
                  defineSimple(macros, 'bit_is_clear', '(!((sfr) & _BV(bit)))', ['sfr', 'bit']);
                  defineSimple(macros, 'loop_until_bit_is_set', 'do { } while (bit_is_clear(sfr, bit))', ['sfr', 'bit']);
                  defineSimple(macros, 'loop_until_bit_is_clear', 'do { } while (bit_is_set(sfr, bit))', ['sfr', 'bit']);
                  defineSimple(macros, '__AVR_ATmega8__', '1');
                }
                if (h === 'util/delay.h') {
                  if (!macros.has('F_CPU')) {
                    ctx.warn('F_CPU ist nicht definiert – <util/delay.h> nimmt 1 MHz an. Schreibe #define F_CPU ... VOR die #include-Zeile.', lineNo);
                    defineSimple(macros, 'F_CPU', '1000000UL');
                  }
                  ctx.delayFcpuAtInclude = ctx.macroValue('F_CPU');
                }
                if (h === 'avr/pgmspace.h') {
                  defineSimple(macros, 'pgm_read_byte', '(*(addr))', ['addr']);
                  defineSimple(macros, 'pgm_read_word', '(*(addr))', ['addr']);
                  defineSimple(macros, 'pgm_read_dword', '(*(addr))', ['addr']);
                }
                break;
              }
              case 'define': {
                const dm = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
                if (!dm) throw new CompileError('#define: Name erwartet', lineNo);
                const name = dm[1];
                const params = dm[2] !== undefined ? dm[3].split(',').map(s => s.trim()).filter(Boolean) : null;
                if (params && dm[2] && rest[name.length] !== '(') throw new CompileError('#define ' + name + ': Leerzeichen vor ( nicht erlaubt', lineNo);
                const body = lex(dm[4] || '', lineNo);
                const old = macros.get(name);
                if (name === 'F_CPU' && ctx.delayFcpuAtInclude != null) {
                  ctx.warn('F_CPU wird nach #include <util/delay.h> (neu) definiert – die Wartezeiten benutzen trotzdem den alten Wert. #define F_CPU muss VOR die #include-Zeile!', lineNo);
                } else if (old && !old.builtin && old.body.map(t => t.s || t.v).join(' ') !== body.map(t => t.s || t.v).join(' ')) {
                  ctx.warn('Makro "' + name + '" wird neu definiert', lineNo);
                }
                macros.set(name, { params, body, line: lineNo });
                break;
              }
              case 'undef': macros.delete(rest.split(/\s+/)[0]); break;
              case 'error': throw new CompileError('#error ' + rest, lineNo);
              case 'warning': ctx.warn('#warning ' + rest, lineNo); break;
              case 'pragma': case 'line': case '': break;
              default: throw new CompileError('Unbekannte Präprozessor-Anweisung #' + dir, lineNo);
            }
        }
        out.push('');
      } else {
        out.push(active ? line : '');
      }
      for (let k = 0; k < extra; k++) out.push('');
    }
    if (stack.length) throw new CompileError('#if/#ifdef ohne passendes #endif', stack[stack.length - 1].line);
    return out.join('\n');
  }

  function expand(tokens, macros) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.t !== 'id' || !macros.has(tk.v) || (tk.hide && tk.hide.has(tk.v))) { out.push(tk); continue; }
      const m = macros.get(tk.v);
      const hide = new Set(tk.hide || []); hide.add(tk.v);
      let body;
      if (m.params) {
        const nx = tokens[i + 1];
        if (!nx || nx.t !== 'op' || nx.v !== '(') { out.push(tk); continue; }
        let depth = 0, j, args = [[]];
        for (j = i + 1; j < tokens.length; j++) {
          const a = tokens[j];
          if (a.t === 'op' && a.v === '(') { depth++; if (depth === 1) continue; }
          else if (a.t === 'op' && a.v === ')') { depth--; if (depth === 0) break; }
          else if (a.t === 'op' && a.v === ',' && depth === 1) { args.push([]); continue; }
          args[args.length - 1].push(a);
        }
        if (j >= tokens.length) throw new CompileError('Makro ' + tk.v + '(...): schließende Klammer fehlt', tk.line, tk.col);
        if (args.length === 1 && args[0].length === 0 && m.params.length === 0) args = [];
        if (args.length !== m.params.length) throw new CompileError('Makro ' + tk.v + ' erwartet ' + m.params.length + ' Argument(e), bekommt ' + args.length, tk.line, tk.col);
        const ex = args.map(a => expand(a, macros));
        body = [];
        for (let b = 0; b < m.body.length; b++) {
          const bt = m.body[b];
          if (bt.t === 'op' && bt.v === '#' && m.body[b + 1] && m.params.includes(m.body[b + 1].v)) {
            const pa = args[m.params.indexOf(m.body[b + 1].v)];
            const s = pa.map(x => x.s || x.v).join(' ');
            body.push({ t: 'str', v: Array.from(s, ch => ch.charCodeAt(0) & 0xFF), line: tk.line, col: tk.col });
            b++; continue;
          }
          if (bt.t === 'op' && bt.v === '##') {
            const prev = body.pop(); const nb = m.body[++b];
            if (!prev || !nb) continue;
            const right = (nb.t === 'id' && m.params.includes(nb.v)) ? args[m.params.indexOf(nb.v)] : [nb];
            const txt = (prev.s || String(prev.v)) + right.map(x => x.s || String(x.v)).join('');
            body.push(...lex(txt, tk.line).map(x => Object.assign(x, { col: tk.col })));
            continue;
          }
          const pi = bt.t === 'id' ? m.params.indexOf(bt.v) : -1;
          if (pi >= 0) for (const x of ex[pi]) body.push(Object.assign({}, x, { line: tk.line, col: tk.col }));
          else body.push(Object.assign({}, bt, { line: tk.line, col: tk.col }));
        }
        i = j;
      } else {
        body = m.body.map(bt => Object.assign({}, bt, { line: tk.line, col: tk.col }));
      }
      for (const x of body) { const h = new Set(x.hide || []); hide.forEach(v => h.add(v)); x.hide = h; }
      const res = expand(body, macros);
      for (const x of res) out.push(x);
    }
    return out;
  }

  // =====================================================================
  // Parser
  // =====================================================================
  const TYPE_KW = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', 'bool', '_Bool',
    'const', 'volatile', 'static', 'extern', 'register', 'inline', 'enum', 'struct', 'union', 'typedef', 'PROGMEM', '__inline__', 'auto']);
  const STD_TYPEDEFS = {
    uint8_t: TY.u8, int8_t: TY.i8, uint16_t: TY.u16, int16_t: TY.i16, uint32_t: TY.u32, int32_t: TY.i32,
    uint64_t: TY.u32, int64_t: TY.i32, size_t: TY.u16, uint_fast8_t: TY.u8, int_fast8_t: TY.i8,
    uint_least8_t: TY.u8, uint_fast16_t: TY.u16, byte: null,
  };
  const STMT_KW = new Set(['if', 'else', 'while', 'do', 'for', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof']);

  function namedInt(t, name) { return Object.assign({}, t, { name }); }

  class Parser {
    constructor(toks, ctx) {
      this.t = toks; this.i = 0; this.ctx = ctx;
      this.typedefs = new Map();
      for (const [k, v] of Object.entries(STD_TYPEDEFS)) if (v) this.typedefs.set(k, namedInt(v, k));
      this.enums = ctx ? ctx.enums : new Map();
    }
    peek(o) { return this.t[this.i + (o || 0)] || { t: 'eof', v: '', line: this.lastLine(), col: 0 }; }
    lastLine() { const l = this.t[this.t.length - 1]; return l ? l.line : 1; }
    next() { const t = this.peek(); this.i++; return t; }
    is(v, o) { const t = this.peek(o); return (t.t === 'op' || t.t === 'id') && t.v === v; }
    accept(v) { if (this.is(v)) { this.i++; return true; } return false; }
    expect(v, what) {
      const t = this.peek();
      if (this.is(v)) { this.i++; return t; }
      const prev = this.t[this.i - 1];
      if (v === ';' && prev) throw new CompileError('";" fehlt' + (what ? ' ' + what : '') + ' (nach "' + (prev.s || prev.v) + '")', prev.line, prev.col);
      throw new CompileError('"' + v + '" erwartet' + (what ? ' ' + what : '') + ', gefunden: ' + tokDesc(t), t.line, t.col);
    }
    err(msg, t) { t = t || this.peek(); throw new CompileError(msg, t.line, t.col); }

    isTypeStart(o) {
      const t = this.peek(o);
      return t.t === 'id' && (TYPE_KW.has(t.v) || this.typedefs.has(t.v));
    }

    // ---------- Programm ----------
    parseProgram() {
      const items = [];
      while (this.peek().t !== 'eof') {
        if (this.accept(';')) continue;
        items.push(...this.parseExternal());
      }
      return items;
    }

    parseExternal() {
      const t = this.peek();
      if (t.t === 'id' && (t.v === 'ISR' || t.v === 'SIGNAL' || t.v === 'INTERRUPT') && this.is('(', 1)) {
        this.next(); this.next();
        const v = this.next();
        if (v.t !== 'id') this.err('Name des Interrupt-Vektors erwartet, z. B. ISR(TIMER1_COMPA_vect)', v);
        while (this.accept(',')) this.next();
        this.expect(')');
        if (!this.is('{')) this.err('"{" erwartet nach ISR(' + v.v + ')');
        const body = this.parseBlock();
        return [{ k: 'isr', vec: v.v, body, line: t.line, col: t.col }];
      }
      if (t.t === 'id' && !this.isTypeStart() && this.is('(', 1)) {
        this.err('Vor "' + t.v + '(" fehlt der Rückgabetyp, z. B. "int ' + t.v + '(void)" oder "void ' + t.v + '(void)". Anweisungen gehören in eine Funktion.', t);
      } else if (!this.isTypeStart()) {
        this.err('Unerwartet: ' + tokDesc(t) + ' – hier wird eine Deklaration oder Funktion erwartet. Anweisungen müssen in einer Funktion (z. B. main) stehen.', t);
      }
      const spec = this.parseSpecs();
      if (spec.typedef) return this.finishTypedef(spec);
      if (this.accept(';')) return [];
      const out = [];
      for (;;) {
        const d = this.parseDeclarator(spec.type, false);
        if (d.func) {
          if (this.is('{')) {
            if (out.length) this.err('Funktionsdefinition nicht in einer Deklarationsliste erlaubt');
            const body = this.parseBlock();
            return [{ k: 'func', name: d.name, ret: d.type, params: d.params, body, line: d.line, col: d.col, spec }];
          }
          out.push({ k: 'proto', name: d.name, ret: d.type, params: d.params, line: d.line, col: d.col });
        } else {
          let init = null;
          if (this.accept('=')) init = this.parseInitializer();
          out.push({ k: 'gvar', name: d.name, type: d.type, init, spec, line: d.line, col: d.col, isConst: d.cq === null ? spec.const : d.cq });
        }
        if (this.accept(',')) continue;
        this.expect(';', 'nach der Deklaration');
        return out;
      }
    }

    finishTypedef(spec) {
      for (;;) {
        const d = this.parseDeclarator(spec.type, false);
        this.typedefs.set(d.name, Object.assign({}, d.type, d.type.k === 'int' ? { name: d.name } : {}));
        if (!this.accept(',')) break;
      }
      this.expect(';', 'nach typedef');
      return [];
    }

    parseSpecs() {
      const sp = { const: false, volatile: false, static: false, typedef: false, extern: false };
      let base = null, uns = false, sig = false, longs = 0, short = false, intKw = false, charKw = false, first = this.peek();
      for (;;) {
        const t = this.peek();
        if (t.t !== 'id') break;
        const v = t.v;
        if (v === 'const') sp.const = true;
        else if (v === 'volatile') sp.volatile = true;
        else if (v === 'static') sp.static = true;
        else if (v === 'extern') sp.extern = true;
        else if (v === 'typedef') sp.typedef = true;
        else if (v === 'register' || v === 'inline' || v === '__inline__' || v === 'PROGMEM' || v === 'auto') { /* ignorieren */ }
        else if (v === 'unsigned') uns = true;
        else if (v === 'signed') sig = true;
        else if (v === 'long') longs++;
        else if (v === 'short') short = true;
        else if (v === 'int') intKw = true;
        else if (v === 'char') charKw = true;
        else if (v === 'void') base = TY.void;
        else if (v === 'float' || v === 'double') base = TY.f32;
        else if (v === 'bool' || v === '_Bool') base = TY.bool;
        else if (v === 'struct' || v === 'union') this.err('"' + v + '" wird in diesem Simulator leider nicht unterstützt', t);
        else if (v === 'enum') { this.next(); base = this.parseEnum(); continue; }
        else if (this.typedefs.has(v) && !base && !uns && !sig && !longs && !short && !intKw && !charKw) base = this.typedefs.get(v);
        else break;
        this.next();
      }
      let type = base;
      if (!type) {
        if (charKw) type = uns ? namedInt(TY.u8, 'unsigned char') : namedInt(TY.i8, sig ? 'signed char' : 'char');
        else if (longs) {
          if (longs > 1) this.ctx.warnOnce('longlong', 'long long (64 Bit) wird im Simulator wie long (32 Bit) behandelt', first.line);
          type = uns ? TY.u32 : TY.i32;
        }
        else if (short) type = uns ? namedInt(TY.u16, 'unsigned short') : namedInt(TY.i16, 'short');
        else if (intKw || uns || sig) type = uns ? TY.u16 : TY.i16;
        else if (sp.const || sp.volatile || sp.static) type = TY.i16;
        else this.err('Datentyp erwartet', first);
      } else if (uns || sig || longs || short || intKw || charKw) {
        if (base.k === 'float' && longs === 1 && !uns) type = TY.f32;
        else this.err('Ungültige Kombination von Datentypen', first);
      }
      sp.type = type;
      return sp;
    }

    parseEnum() {
      const t = this.peek();
      if (t.t === 'id' && !this.is('{')) this.next();
      if (this.accept('{')) {
        let val = 0;
        while (!this.accept('}')) {
          const n = this.next();
          if (n.t !== 'id') this.err('Name in enum erwartet', n);
          if (this.accept('=')) val = this.constEval(this.parseCond());
          this.enums.set(n.v, val);
          val++;
          if (!this.accept(',')) { this.expect('}', 'am Ende der enum'); break; }
        }
      }
      return namedInt(TY.i16, 'enum');
    }

    parseDeclarator(base, abstract) {
      let t = base, cq = null;
      while (this.accept('*')) {
        t = ptrT(t); cq = false;
        for (;;) { if (this.accept('const')) cq = true; else if (!this.accept('volatile')) break; }
      }
      const nt = this.peek();
      let name = null;
      if (nt.t === 'id' && !TYPE_KW.has(nt.v)) {
        if (STMT_KW.has(nt.v)) this.err('"' + nt.v + '" ist ein reserviertes Wort und kann kein Name sein', nt);
        name = nt.v; this.next();
      } else if (!abstract) {
        if (this.is('(')) this.err('Funktionszeiger werden nicht unterstützt', nt);
        this.err('Name erwartet, gefunden: ' + tokDesc(nt), nt);
      }
      if (this.is('(') && name) {
        this.next();
        const params = [];
        if (this.is('void') && this.is(')', 1)) { this.next(); }
        if (!this.is(')')) {
          for (;;) {
            if (this.is('...')) this.err('Variable Argumentlisten (...) werden nicht unterstützt');
            const ps = this.parseSpecs();
            const pd = this.parseDeclarator(ps.type, true);
            let pt = pd.type;
            if (pt.k === 'arr') pt = ptrT(pt.of);
            if (pt.k === 'void') this.err('Parameter vom Typ void nicht erlaubt');
            params.push({ name: pd.name, type: pt, const: pd.cq === null ? ps.const : pd.cq, line: pd.line });
            if (!this.accept(',')) break;
          }
        }
        this.expect(')', 'nach der Parameterliste');
        return { name, type: t, func: true, params, line: nt.line, col: nt.col, cq };
      }
      const dims = [];
      while (this.accept('[')) {
        if (this.accept(']')) { dims.push(null); continue; }
        const e = this.parseCond();
        let n;
        try { n = this.constEval(e); } catch (err) {
          throw new CompileError('Die Arraygröße muss eine Konstante sein (z. B. Zahl oder #define)', e.line, e.col);
        }
        if (n <= 0) throw new CompileError('Arraygröße muss größer als 0 sein', e.line, e.col);
        dims.push(n);
        this.expect(']');
      }
      for (let k = dims.length - 1; k >= 0; k--) {
        if (dims[k] === null && k > 0) this.err('Nur die erste Arraygröße darf leer bleiben', nt);
        t = arrT(t, dims[k]);
      }
      return { name, type: t, line: nt.line, col: nt.col, cq };
    }

    parseTypeName() {
      const sp = this.parseSpecs();
      return this.parseDeclarator(sp.type, true).type;
    }

    parseInitializer() {
      const t = this.peek();
      if (this.accept('{')) {
        const items = [];
        while (!this.accept('}')) {
          items.push(this.parseInitializer());
          if (!this.accept(',')) { this.expect('}', 'am Ende der Initialisierung'); break; }
        }
        return { k: 'ilist', items, line: t.line, col: t.col };
      }
      return this.parseAssign();
    }

    // ---------- Anweisungen ----------
    parseBlock() {
      const t = this.expect('{');
      const body = [];
      while (!this.is('}')) {
        if (this.peek().t === 'eof') throw new CompileError('"}" fehlt – der Block aus Zeile ' + t.line + ' wird nicht geschlossen', t.line, t.col);
        body.push(this.parseStmt());
      }
      const e = this.next();
      return { k: 'block', body, line: t.line, col: t.col, endLine: e.line };
    }

    parseStmt() {
      const t = this.peek();
      if (t.t === 'op') {
        if (t.v === '{') return this.parseBlock();
        if (t.v === ';') { this.next(); return { k: 'empty', line: t.line }; }
      }
      if (t.t === 'id') {
        switch (t.v) {
          case 'if': {
            this.next(); this.expect('(', 'nach if');
            const c = this.parseExpr(); this.expect(')', 'nach der if-Bedingung');
            const th = this.parseStmt();
            let el = null;
            if (this.accept('else')) el = this.parseStmt();
            return { k: 'if', c, t: th, e: el, line: t.line, col: t.col };
          }
          case 'while': {
            this.next(); this.expect('(', 'nach while');
            const c = this.parseExpr(); this.expect(')', 'nach der while-Bedingung');
            const b = this.parseStmt();
            return { k: 'while', c, b, line: t.line, col: t.col };
          }
          case 'do': {
            this.next();
            const b = this.parseStmt();
            const w = this.expect('while', 'nach dem do-Block');
            this.expect('(');
            const c = this.parseExpr(); this.expect(')');
            this.expect(';', 'nach do ... while(...)');
            return { k: 'do', b, c, line: t.line, col: t.col, wline: w.line };
          }
          case 'for': {
            this.next(); this.expect('(', 'nach for');
            let init = null;
            if (this.isTypeStart()) init = this.parseDecl();
            else if (!this.accept(';')) { const e = this.parseExpr(); init = { k: 'expr', e, line: e.line }; this.expect(';', 'im for-Kopf'); }
            let c = null; if (!this.is(';')) c = this.parseExpr(); this.expect(';', 'im for-Kopf');
            let step = null; if (!this.is(')')) step = this.parseExpr(); this.expect(')', 'am Ende des for-Kopfes');
            const b = this.parseStmt();
            return { k: 'for', init, c, step, b, line: t.line, col: t.col };
          }
          case 'switch': {
            this.next(); this.expect('(', 'nach switch');
            const c = this.parseExpr(); this.expect(')');
            if (!this.is('{')) this.err('"{" erwartet nach switch(...)');
            const b = this.parseBlock();
            return { k: 'switch', c, b, line: t.line, col: t.col };
          }
          case 'case': {
            this.next();
            const e = this.parseCond();
            const v = this.constEval(e);
            this.expect(':', 'nach case ' + v);
            return { k: 'case', v, line: t.line, col: t.col };
          }
          case 'default': this.next(); this.expect(':', 'nach default'); return { k: 'default', line: t.line, col: t.col };
          case 'break': this.next(); this.expect(';', 'nach break'); return { k: 'break', line: t.line, col: t.col };
          case 'continue': this.next(); this.expect(';', 'nach continue'); return { k: 'continue', line: t.line, col: t.col };
          case 'return': {
            this.next();
            let e = null; if (!this.is(';')) e = this.parseExpr();
            this.expect(';', 'nach return');
            return { k: 'return', e, line: t.line, col: t.col };
          }
          case 'goto': this.err('goto wird nicht unterstützt (und sollte auch nicht benutzt werden 😉)', t);
          case 'else': this.err('"else" ohne passendes "if" – steht vielleicht ein ";" direkt hinter if(...)?', t);
          case 'asm': case '__asm__':
            this.err('Inline-Assembler (asm) wird im Simulator nicht unterstützt', t);
        }
        if (this.isTypeStart()) return this.parseDecl();
      }
      const e = this.parseExpr();
      this.expect(';', 'nach der Anweisung');
      return { k: 'expr', e, line: t.line, col: t.col };
    }

    parseDecl() {
      const t = this.peek();
      const spec = this.parseSpecs();
      if (spec.typedef) { this.finishTypedef(spec); return { k: 'empty', line: t.line }; }
      const vars = [];
      if (this.accept(';')) return { k: 'empty', line: t.line };
      for (;;) {
        const d = this.parseDeclarator(spec.type, false);
        if (d.func) this.err('Funktionen dürfen nicht innerhalb einer Funktion deklariert/definiert werden – steht eine "}" zu wenig davor?', t);
        let init = null;
        if (this.accept('=')) init = this.parseInitializer();
        vars.push({ name: d.name, type: d.type, init, line: d.line, col: d.col, spec, isConst: d.cq === null ? spec.const : d.cq });
        if (!this.accept(',')) break;
      }
      this.expect(';', 'nach der Deklaration');
      return { k: 'decl', vars, line: t.line, col: t.col };
    }

    // ---------- Ausdrücke ----------
    parseExpr() {
      let e = this.parseAssign();
      while (this.is(',')) {
        const t = this.next();
        const b = this.parseAssign();
        e = { k: 'comma', a: e, b, line: t.line, col: t.col };
      }
      return e;
    }
    parseAssign() {
      const left = this.parseCond();
      const t = this.peek();
      if (t.t === 'op' && /^(=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=)$/.test(t.v)) {
        this.next();
        const right = this.parseAssign();
        return { k: 'asg', op: t.v, a: left, b: right, line: t.line, col: t.col };
      }
      return left;
    }
    parseCond() {
      const c = this.parseBin(1);
      if (this.is('?')) {
        const t = this.next();
        const a = this.parseExpr();
        this.expect(':', 'im Bedingungsoperator ?:');
        const b = this.parseCond();
        return { k: 'cond', c, a, b, line: t.line, col: t.col };
      }
      return c;
    }
    parseBin(minPrec) {
      let left = this.parseUnary();
      for (;;) {
        const t = this.peek();
        const p = t.t === 'op' ? BIN_PREC[t.v] : undefined;
        if (!p || p < minPrec) return left;
        this.next();
        const right = this.parseBin(p + 1);
        left = { k: 'bin', op: t.v, a: left, b: right, line: t.line, col: t.col };
      }
    }
    parseUnary() {
      const t = this.peek();
      if (t.t === 'op') {
        switch (t.v) {
          case '++': case '--': this.next(); return { k: 'pre', op: t.v, a: this.parseUnary(), line: t.line, col: t.col };
          case '-': case '+': case '!': case '~': this.next(); return { k: 'un', op: t.v, a: this.parseUnary(), line: t.line, col: t.col };
          case '*': this.next(); return { k: 'deref', a: this.parseUnary(), line: t.line, col: t.col };
          case '&': this.next(); return { k: 'addr', a: this.parseUnary(), line: t.line, col: t.col };
          case '(':
            if (this.isTypeStart(1)) {
              this.next();
              const to = this.parseTypeName();
              this.expect(')', 'nach dem Typ im Cast');
              return { k: 'cast', to, a: this.parseUnary(), line: t.line, col: t.col };
            }
        }
      }
      if (t.t === 'id' && t.v === 'sizeof') {
        this.next();
        if (this.is('(') && this.isTypeStart(1)) {
          this.next(); const to = this.parseTypeName(); this.expect(')');
          return { k: 'sizeof', to, line: t.line, col: t.col };
        }
        return { k: 'sizeof', a: this.parseUnary(), line: t.line, col: t.col };
      }
      return this.parsePostfix();
    }
    parsePostfix() {
      let e = this.parsePrimary();
      for (;;) {
        const t = this.peek();
        if (t.t !== 'op') return e;
        if (t.v === '[') {
          this.next(); const i = this.parseExpr(); this.expect(']');
          e = { k: 'idx', a: e, i, line: t.line, col: t.col };
        } else if (t.v === '(') {
          this.next();
          const args = [];
          if (!this.is(')')) { for (;;) { args.push(this.parseAssign()); if (!this.accept(',')) break; } }
          this.expect(')', 'nach den Argumenten');
          if (e.k !== 'id') this.err('Nur direkte Funktionsaufrufe werden unterstützt', t);
          e = { k: 'call', name: e.name, args, line: e.line, col: e.col };
        } else if (t.v === '++' || t.v === '--') {
          this.next(); e = { k: 'post', op: t.v, a: e, line: t.line, col: t.col };
        } else if (t.v === '.' || t.v === '->') {
          this.err('Strukturen (. und ->) werden nicht unterstützt', t);
        } else return e;
      }
    }
    parsePrimary() {
      const t = this.next();
      if (t.t === 'num') return { k: 'num', v: t.v, type: t.ty, line: t.line, col: t.col };
      if (t.t === 'str') {
        let v = t.v.slice();
        while (this.peek().t === 'str') v = v.concat(this.next().v);
        return { k: 'str', v, line: t.line, col: t.col };
      }
      if (t.t === 'id') {
        if (t.v === 'true') return { k: 'num', v: 1, type: TY.i16, line: t.line, col: t.col };
        if (t.v === 'false') return { k: 'num', v: 0, type: TY.i16, line: t.line, col: t.col };
        if (t.v === 'NULL') return { k: 'num', v: 0, type: TY.i16, line: t.line, col: t.col, isNull: true };
        if (this.enums.has(t.v)) return { k: 'num', v: this.enums.get(t.v), type: TY.i16, line: t.line, col: t.col };
        if (TYPE_KW.has(t.v) || this.typedefs.has(t.v)) throw new CompileError('Hier wird ein Wert erwartet, nicht der Typ "' + t.v + '"', t.line, t.col);
        if (STMT_KW.has(t.v)) throw new CompileError('"' + t.v + '" an dieser Stelle nicht erlaubt – fehlt davor ein ";" oder eine Klammer?', t.line, t.col);
        return { k: 'id', name: t.v, line: t.line, col: t.col };
      }
      if (t.t === 'op' && t.v === '(') {
        const e = this.parseExpr();
        this.expect(')', '(Klammer nicht geschlossen)');
        e.paren = true;
        return e;
      }
      if (t.t === 'eof') throw new CompileError('Unerwartetes Ende des Programms – fehlt eine "}"?', t.line, t.col);
      throw new CompileError('Ausdruck erwartet, gefunden: ' + tokDesc(t), t.line, t.col);
    }

    // Konstante Ausdrücke (Arraygrößen, case, enum, #if)
    constEval(e) {
      const c = x => this.constEval(x);
      switch (e.k) {
        case 'num': return e.v;
        case 'un': { const a = c(e.a); return e.op === '-' ? -a : e.op === '+' ? a : e.op === '!' ? (a ? 0 : 1) : ~a; }
        case 'cast': { const a = c(e.a); return isInt(e.to) ? wrapOf(e.to)(Math.trunc(a)) : a; }
        case 'sizeof': if (e.to) return sizeOf(e.to); break;
        case 'cond': return c(e.c) ? c(e.a) : c(e.b);
        case 'bin': {
          const a = c(e.a), b = c(e.b);
          switch (e.op) {
            case '+': return a + b; case '-': return a - b; case '*': return a * b;
            case '/': if (!b) throw new CompileError('Division durch 0', e.line); return Math.trunc(a / b);
            case '%': if (!b) throw new CompileError('Division durch 0', e.line); return a % b;
            case '<<': return a * Math.pow(2, b); case '>>': return Math.floor(a / Math.pow(2, b));
            case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
            case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
            case '==': return +(a === b); case '!=': return +(a !== b);
            case '&&': return +(a && b); case '||': return +(a || b);
          }
        }
      }
      throw new CompileError('Konstanter Ausdruck erwartet', e.line, e.col);
    }
  }
  const BIN_PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

  function isEmptyStmt(st) { return st.k === 'empty' || (st.k === 'block' && st.body.every(isEmptyStmt)); }

  function tokDesc(t) {
    if (!t || t.t === 'eof') return 'Ende des Programms';
    if (t.t === 'str') return 'Zeichenkette';
    return '"' + (t.s || t.v) + '"';
  }

  // =====================================================================
  // Eingebaute Funktionen
  // =====================================================================
  const PCHAR = ptrT(TY.i8);
  const BUILTINS = {
    _delay_ms: { params: [TY.f32], ret: TY.void, g: true, inc: 'util/delay.h' },
    _delay_us: { params: [TY.f32], ret: TY.void, g: true, inc: 'util/delay.h' },
    sei: { params: [], ret: TY.void, inc: 'avr/interrupt.h' },
    cli: { params: [], ret: TY.void, inc: 'avr/interrupt.h' },
    _NOP: { params: [], ret: TY.void, inc: 'avr/cpufunc.h' },
    wdt_reset: { params: [], ret: TY.void, inc: 'avr/wdt.h' },
    abs: { params: [TY.i16], ret: TY.i16, inc: 'stdlib.h' },
    labs: { params: [TY.i32], ret: TY.i32, inc: 'stdlib.h' },
    rand: { params: [], ret: TY.i16, inc: 'stdlib.h' },
    srand: { params: [TY.u16], ret: TY.void, inc: 'stdlib.h' },
    itoa: { params: [TY.i16, PCHAR, TY.i16], ret: PCHAR, inc: 'stdlib.h' },
    utoa: { params: [TY.u16, PCHAR, TY.i16], ret: PCHAR, inc: 'stdlib.h' },
    ltoa: { params: [TY.i32, PCHAR, TY.i16], ret: PCHAR, inc: 'stdlib.h' },
    ultoa: { params: [TY.u32, PCHAR, TY.i16], ret: PCHAR, inc: 'stdlib.h' },
    strlen: { params: [PCHAR], ret: TY.u16, inc: 'string.h' },
  };

  // =====================================================================
  // Semantische Analyse
  // =====================================================================
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    return d[m][n];
  }

  class Analyzer {
    constructor(items, ctx) {
      this.items = items; this.ctx = ctx;
      this.scopes = [new Map()];
      this.funcs = new Map();
      this.globals = [];
      this.isrs = new Map();
      this.fn = null;
      this.loopDepth = 0; this.switchDepth = 0;
      this.strings = [];
      this.statics = [];
    }
    err(msg, n) { throw new CompileError(msg, n && n.line, n && n.col); }
    warn(msg, n) { this.ctx.warn(msg, n && n.line); }

    lookup(name) {
      for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i].get(name); if (s) return s; }
      return null;
    }
    declare(sym, n) {
      const sc = this.scopes[this.scopes.length - 1];
      const old = sc.get(sym.name);
      if (old && !(old.kind === 'var' && old.extern)) this.err('"' + sym.name + '" wurde in diesem Bereich schon deklariert (Zeile ' + old.line + ')', n);
      if (this.scopes.length > 1 && old === undefined) {
        const outer = this.lookup(sym.name);
        if (outer && outer.kind === 'io') this.err('"' + sym.name + '" ist ein Registername und kann nicht als Variable benutzt werden', n);
      }
      sc.set(sym.name, sym);
    }

    run() {
      const g = this.scopes[0];
      if (this.ctx.ioDefined) for (const [name, bits] of Object.entries(AVR.REGS)) g.set(name, { kind: 'io', name, type: bits === 16 ? TY.u16 : TY.u8, line: 0 });
      // 1. Durchgang: Funktionen sammeln
      for (const it of this.items) {
        if (it.k === 'func' || it.k === 'proto') {
          let f = this.funcs.get(it.name);
          if (BUILTINS[it.name]) {
            if (it.k === 'func') this.err('"' + it.name + '" ist schon eine eingebaute Funktion', it);
            continue;
          }
          if (!f) {
            f = { name: it.name, ret: it.ret, params: it.params, line: it.line, declLine: it.line, body: null, nslots: 0, locals: [] };
            this.funcs.set(it.name, f);
          } else {
            if (f.params.length !== it.params.length || f.ret.name !== it.ret.name) this.err('"' + it.name + '" passt nicht zur früheren Deklaration in Zeile ' + f.declLine, it);
          }
          if (it.k === 'func') {
            if (f.body) this.err('Funktion "' + it.name + '" ist doppelt definiert (auch in Zeile ' + f.line + ')', it);
            f.body = it.body; f.params = it.params; f.line = it.line; f.def = it;
          }
        }
      }
      // 2. Durchgang in Reihenfolge
      const seen = new Set();
      for (const it of this.items) {
        if (it.k === 'proto') { seen.add(it.name); if (!BUILTINS[it.name]) g.set(it.name, { kind: 'func', name: it.name, f: this.funcs.get(it.name), line: it.line }); }
        else if (it.k === 'func') {
          seen.add(it.name);
          g.set(it.name, { kind: 'func', name: it.name, f: this.funcs.get(it.name), line: it.line });
          this.seenFuncs = seen;
          this.analyzeFunc(this.funcs.get(it.name), it);
        } else if (it.k === 'gvar') this.globalVar(it);
        else if (it.k === 'isr') {
          const vi = AVR.VECTORS.indexOf(it.vec);
          if (vi < 0) {
            const ds = AVR.VECTORS.map(v => [v, levenshtein(v, it.vec)]);
            const min = Math.min(...ds.map(d => d[1]));
            const best = ds.filter(d => d[1] === min).map(d => d[0]);
            this.err('Unbekannter Interrupt-Vektor "' + it.vec + '"' + (min <= 4 ? ' – meintest du ' + best.join(' oder ') + '?' : ''), it);
          }
          if (this.isrs.has(vi)) this.err('ISR(' + it.vec + ') ist doppelt definiert', it);
          if (!this.ctx.includes.has('avr/interrupt.h')) this.warn('Für ISR(...) fehlt #include <avr/interrupt.h>', it);
          const f = { name: 'ISR(' + it.vec + ')', ret: TY.void, params: [], line: it.line, body: it.body, nslots: 0, locals: [], isr: true };
          this.isrs.set(vi, f);
          this.seenFuncs = seen;
          this.analyzeFunc(f, it);
        }
      }
      for (const f of this.funcs.values()) if (f.used && !f.body) this.err('Funktion "' + f.name + '" wurde deklariert, aber nirgends programmiert (Funktionsrumpf fehlt)', { line: f.declLine });
      const main = this.funcs.get('main');
      if (!main || !main.body) throw new CompileError('Es fehlt die Funktion main – jedes Programm braucht "int main(void) { ... }"', 1);
      if (main.ret.k !== 'int') this.warn('main sollte "int main(void)" sein', { line: main.line });
      if (main.params.length) this.warn('main hat beim Mikrocontroller keine Parameter: int main(void)', { line: main.line });
      for (const [vi, f] of this.isrs) {
        const bit = { 0: ['GICR', 'INT0'], 1: ['GICR', 'INT1'], 5: ['TIMSK', 'OCIE1A'], 7: ['TIMSK', 'TOIE1'], 8: ['TIMSK', 'TOIE0'], 2: ['TIMSK', 'OCIE2'], 3: ['TIMSK', 'TOIE2'], 13: ['ADCSRA', 'ADIE'], 10: ['UCSRB', 'RXCIE'] }[vi];
        f.enableHint = bit;
      }
      let ram = 0;
      for (const s of this.globals) ram += sizeOf(s.type);
      for (const s of this.strings) ram += s.d.length;
      for (const s of this.statics) ram += sizeOf(s.type);
      return { funcs: this.funcs, main, isrs: this.isrs, globals: this.globals, statics: this.statics, ram };
    }

    newStore(type, name) {
      const base = scalarBase(type);
      const n = cells(type);
      const d = new Array(n);
      const z = base.k === 'ptr' ? null : 0;
      for (let i = 0; i < n; i++) d[i] = z;
      return { t: base, d, name, type };
    }

    globalVar(it) {
      let type = it.type;
      if (type.k === 'void') this.err('Variable "' + it.name + '" kann nicht vom Typ void sein', it);
      const init = it.init ? this.initializer(type, it.init, it) : null;
      if (init && init.type) type = init.type;
      if (type.k === 'arr' && !type.n) this.err('Größe des Arrays "' + it.name + '" unbekannt', it);
      const sym = { kind: 'var', name: it.name, type, global: true, const: it.isConst, volatile: it.spec.volatile, line: it.line, extern: it.spec.extern && !init };
      const old = this.scopes[0].get(it.name);
      if (old && old.kind === 'var' && (old.extern || sym.extern)) { if (sym.extern) return; old.extern = false; old.init = init; return; }
      this.declare(sym, it);
      sym.store = this.newStore(type, it.name);
      sym.init = init;
      if (init) this.checkPure(init, it);
      this.globals.push(sym);
    }
    checkPure(init, it) {
      const walk = n => {
        if (!n || typeof n !== 'object') return;
        if (n.k === 'call') this.err('Globale Variablen dürfen nur mit Konstanten initialisiert werden (kein Funktionsaufruf)', it);
        for (const k of ['a', 'b', 'c', 'i', 'e']) if (n[k] && typeof n[k] === 'object') walk(n[k]);
        if (n.cellsInit) n.cellsInit.forEach(x => walk(x && x.e));
        if (n.e) walk(n.e);
      };
      walk(init);
    }

    // Initialisierer -> { scalar: expr } oder { cellsInit: [ {i, e} ], type }
    initializer(type, init, at) {
      if (type.k !== 'arr') {
        let e = init;
        if (init.k === 'ilist') {
          if (init.items.length !== 1 || init.items[0].k === 'ilist') this.err('Eine einzelne Variable braucht auch nur einen Wert', init);
          e = init.items[0];
        }
        this.ex(e);
        this.checkAssign(type, e, at);
        return { e, cv: wrapOf(type) };
      }
      const base = scalarBase(type);
      const out = [];
      let total;
      if (init.k === 'str') {
        if (!(type.of.k === 'int' && type.of.bits === 8)) this.err('Eine Zeichenkette kann nur ein char-Array initialisieren', init);
        const n = type.n || init.v.length + 1;
        if (init.v.length > n) this.err('Zeichenkette ist zu lang für das Array (' + n + ' Zeichen Platz)', init);
        else if (init.v.length === n) this.warn('Kein Platz für das abschließende \\0 der Zeichenkette', init);
        init.v.forEach((c, i) => out.push({ i, e: { k: 'num', v: c, type: TY.i16 } }));
        total = n;
        return { cellsInit: out, type: type.n ? type : arrT(type.of, n), cv: wrapOf(base), str: true };
      }
      if (init.k !== 'ilist') this.err('Ein Array wird mit { ... } initialisiert', init);
      const scalarItem = (item, p) => {
        this.ex(item); this.checkAssign(base, item, at);
        out.push({ i: p, e: item });
      };
      // füllt Array t ab Zelle start, gibt Anzahl der (obersten) Elemente zurück
      const fill = (t, il, start) => {
        const sc = cells(t.of);
        const items = il.items;
        if (t.of.k === 'arr' && items.length && items[0].k !== 'ilist' && items[0].k !== 'str') {
          // flache Schreibweise: int m[2][2] = {1, 2, 3, 4};
          if (t.n && items.length > t.n * sc) this.err('Zu viele Werte in der Initialisierung (Platz für ' + (t.n * sc) + ')', items[0]);
          items.forEach((item, k) => {
            if (item.k === 'ilist') this.err('Gemischte Klammerung in der Initialisierung wird nicht unterstützt', item);
            scalarItem(item, start + k);
          });
          return Math.ceil(items.length / sc);
        }
        items.forEach((item, k) => {
          if (t.n && k >= t.n) this.err('Zu viele Werte in der Initialisierung (das Array hat ' + t.n + ' Elemente)', item);
          const p = start + k * sc;
          if (t.of.k === 'arr') {
            if (item.k === 'str') {
              if (item.v.length > t.of.n) this.err('Zeichenkette zu lang', item);
              item.v.forEach((c, i) => out.push({ i: p + i, e: { k: 'num', v: c, type: TY.i16 } }));
            } else if (item.k === 'ilist') fill(t.of, item, p);
            else this.err('{ ... } erwartet', item);
          } else {
            if (item.k === 'ilist') this.err('Zu viele geschweifte Klammern in der Initialisierung', item);
            scalarItem(item, p);
          }
        });
        return items.length;
      };
      const count = fill(type, init, 0);
      const n = type.n || count;
      if (!n) this.err('Leere Initialisierung { } – das Array braucht mindestens ein Element', init);
      return { cellsInit: out, type: type.n ? type : arrT(type.of, n), cv: wrapOf(base) };
    }

    checkAssign(to, e, at) {
      const from = e.type;
      if (!from) return;
      if (to.k === 'void') this.err('void kann kein Wert zugewiesen werden', at);
      if (isArith(to) && from.k === 'void') this.err('Ausdruck hat keinen Wert (void)', e);
      if (isArith(to) && isPtrLike(from)) this.warn('Zeiger/Array wird einer Zahl zugewiesen – fehlt ein [ ] oder * ?', e);
      if (to.k === 'ptr' && isArith(from) && !(e.k === 'num' && e.v === 0)) this.warn('Zahl wird einem Zeiger zugewiesen', e);
      if (isInt(to) && to.k === 'int' && e.k === 'num' && isInt(e.type)) {
        const v = e.v;
        const min = to.s ? -Math.pow(2, to.bits - 1) : -Math.pow(2, to.bits - 1);
        const max = to.s ? Math.pow(2, to.bits - 1) - 1 : Math.pow(2, to.bits) - 1;
        if (v > max || v < min) this.warn('Wert ' + v + ' passt nicht in ' + to.name + ' (' + (to.s ? min : 0) + ' … ' + max + ') – wird abgeschnitten zu ' + wrapOf(to)(v), e);
      }
    }

    analyzeFunc(f, it) {
      this.fn = f;
      this.scopes.push(new Map());
      f.params.forEach((p, i) => {
        if (!p.name) this.err('Parameter ' + (i + 1) + ' von "' + f.name + '" braucht einen Namen', it);
        const sym = { kind: 'var', name: p.name, type: p.type, slot: f.nslots++, const: p.const, line: p.line || it.line, param: true };
        this.declare(sym, it);
        f.locals.push(sym);
      });
      f.retCv = wrapOf(f.ret);
      f.pcv = f.params.map(p => wrapOf(p.type));
      this.block(f.body, false);
      this.scopes.pop();
      if (f.ret.k !== 'void' && f.name !== 'main' && !this.endsWithReturn(f.body)) this.warn('Funktion "' + f.name + '" gibt einen Wert zurück (' + f.ret.name + '), aber am Ende fehlt "return"', { line: f.body.endLine });
      this.fn = null;
    }
    endsWithReturn(b) {
      const last = b.body[b.body.length - 1];
      if (!last) return false;
      if (last.k === 'return') return true;
      if (last.k === 'while' && last.c.k === 'num' && last.c.v) return true;
      if (last.k === 'for' && !last.c) return true;
      if (last.k === 'if' && last.e) return this.stmtReturns(last.t) && this.stmtReturns(last.e);
      if (last.k === 'block') return this.endsWithReturn(last);
      return false;
    }
    stmtReturns(s) { return s.k === 'return' || (s.k === 'block' && this.endsWithReturn(s)) || (s.k === 'if' && s.e && this.stmtReturns(s.t) && this.stmtReturns(s.e)); }

    block(b, scope = true) {
      if (scope) this.scopes.push(new Map());
      for (const s of b.body) this.stmt(s);
      if (scope) this.scopes.pop();
    }

    cost(e) {
      if (!e) return 0;
      let c = 1;
      for (const k of ['a', 'b', 'c', 'i']) if (e[k] && typeof e[k] === 'object' && e[k].k) c += this.cost(e[k]);
      if (e.args) for (const a of e.args) c += this.cost(a);
      return c;
    }

    cond(e) {
      this.ex(e);
      if (e.type.k === 'void') this.err('Bedingung hat keinen Wert (void-Funktion?)', e);
      if (e.k === 'asg' && e.op === '=' && !e.paren) this.warn('Zuweisung "=" in einer Bedingung – meintest du "==" ?', e);
    }

    stmt(s) {
      switch (s.k) {
        case 'block': this.block(s); return;
        case 'empty': return;
        case 'expr':
          this.ex(s.e); s.c = 1 + this.cost(s.e);
          if (s.e.k === 'bin' && ['==', '!=', '<', '>', '<=', '>='].includes(s.e.op)) this.warn('Vergleich ohne Wirkung – meintest du "=" statt "==" ?', s.e);
          else if (s.e.k === 'id' || s.e.k === 'num') this.warn('Anweisung ohne Wirkung', s.e);
          return;
        case 'decl':
          s.c = 1;
          for (const v of s.vars) {
            let type = v.type;
            if (type.k === 'void') this.err('Variable "' + v.name + '" kann nicht vom Typ void sein', v);
            if (v.spec.extern) this.err('extern ist innerhalb von Funktionen nicht sinnvoll', v);
            const init = v.init ? this.initializer(type, v.init, v) : null;
            if (init && init.type) type = init.type;
            if (type.k === 'arr' && !type.n) this.err('Größe des Arrays "' + v.name + '" unbekannt', v);
            if (v.isConst && !init) this.warn('Konstante "' + v.name + '" ohne Wert', v);
            const sym = { kind: 'var', name: v.name, type, slot: this.fn.nslots++, const: v.isConst, line: v.line, static: v.spec.static };
            if (v.spec.static) { sym.store = null; this.statics.push(sym); }
            this.declare(sym, v);
            this.fn.locals.push(sym);
            v.sym = sym; v.initD = init; v.ty = type;
            if (init) s.c += init.e ? this.cost(init.e) : init.cellsInit.length;
          }
          return;
        case 'if':
          this.cond(s.c); s.c2 = 1 + this.cost(s.c);
          this.subStmt(s.t, s); if (s.e) this.subStmt(s.e, s);
          if (s.t.k === 'empty' && !s.e) this.warn('Leere if-Anweisung – steht ein ";" direkt hinter if(...)?', s);
          return;
        case 'while':
          this.cond(s.c); s.c2 = 1 + this.cost(s.c);
          this.loopDepth++; this.subStmt(s.b, s); this.loopDepth--;
          s.idle = isEmptyStmt(s.b) && s.c.k === 'num' && s.c.v !== 0;
          return;
        case 'do':
          this.loopDepth++; this.subStmt(s.b, s); this.loopDepth--;
          this.cond(s.c); s.c2 = 1 + this.cost(s.c);
          return;
        case 'for':
          this.scopes.push(new Map());
          if (s.init) this.stmt(s.init);
          if (s.c) this.cond(s.c);
          if (s.step) this.ex(s.step);
          s.c2 = 1 + this.cost(s.c) + this.cost(s.step);
          this.loopDepth++; this.subStmt(s.b, s); this.loopDepth--;
          s.idle = isEmptyStmt(s.b) && !s.step && (!s.c || (s.c.k === 'num' && s.c.v !== 0));
          this.scopes.pop();
          return;
        case 'switch': {
          this.ex(s.c);
          if (!isInt(s.c.type)) this.err('switch braucht eine ganze Zahl', s.c);
          s.c2 = 2 + this.cost(s.c);
          s.ct = promote(s.c.type);
          s.cv = wrapOf(s.ct);
          s.map = new Map(); s.def = -1;
          this.switchDepth++;
          this.scopes.push(new Map());
          s.b.body.forEach((st, i) => {
            if (st.k === 'case') {
              const v = s.cv(st.v);
              if (s.map.has(v)) this.err('case ' + st.v + ' kommt doppelt vor', st);
              s.map.set(v, i);
            } else if (st.k === 'default') {
              if (s.def >= 0) this.err('default kommt doppelt vor', st);
              s.def = i;
            } else this.stmt(st);
          });
          this.scopes.pop();
          this.switchDepth--;
          return;
        }
        case 'case': case 'default': this.err('"' + s.k + '" darf nur direkt im { }-Block eines switch stehen', s); return;
        case 'break': if (!this.loopDepth && !this.switchDepth) this.err('break außerhalb einer Schleife oder eines switch', s); s.c = 1; return;
        case 'continue': if (!this.loopDepth) this.err('continue außerhalb einer Schleife', s); s.c = 1; return;
        case 'return': {
          s.c = 2;
          const f = this.fn;
          if (s.e) {
            this.ex(s.e); s.c += this.cost(s.e);
            if (f.ret.k === 'void') this.err('void-Funktion "' + f.name + '" darf keinen Wert zurückgeben', s);
            this.checkAssign(f.ret, s.e, s);
          } else if (f.ret.k !== 'void' && f.name !== 'main') this.warn('return ohne Wert in Funktion "' + f.name + '"', s);
          s.cv = f.retCv;
          return;
        }
      }
      this.err('Unbekannte Anweisung', s);
    }
    subStmt(st, parent) {
      if (st.k === 'decl') this.err('Eine Deklaration braucht hier geschweifte Klammern { }', st);
      this.stmt(st);
    }

    // ---------- Ausdrücke typisieren ----------
    lvalue(n, what) {
      if (n.k === 'id' && n.sym && n.sym.kind === 'var') {
        if (n.sym.type.k === 'arr') this.err('Einem ganzen Array kann man nichts zuweisen – benutze ' + n.name + '[i]', n);
        if (n.sym.const) this.err('"' + n.name + '" ist const und kann nicht verändert werden', n);
        return;
      }
      if (n.k === 'id' && n.io) {
        if (/^PIN[BCD]$/.test(n.io)) this.warn(n.io + ' ist das Eingangsregister – zum Schalten von Ausgängen benutze PORT' + n.io[3], n);
        return;
      }
      if (n.k === 'idx' || n.k === 'deref') {
        if (n.type.k === 'arr') this.err('Einem Array kann man nichts zuweisen', n);
        return;
      }
      this.err('Links von "' + what + '" muss eine Variable stehen', n);
    }

    unknownId(n) {
      const name = n.name;
      if (AVR.REGS[name] !== undefined && !this.ctx.ioDefined) this.err('"' + name + '" ist unbekannt – fehlt #include <avr/io.h> ?', n);
      if (AVR.BITS[name] !== undefined && !this.ctx.ioDefined) this.err('"' + name + '" ist unbekannt – fehlt #include <avr/io.h> ?', n);
      if (name === 'F_CPU') this.err('F_CPU ist nicht definiert – schreibe z. B. #define F_CPU 1000000UL', n);
      const cands = [];
      for (const sc of this.scopes) for (const k of sc.keys()) cands.push(k);
      if (this.ctx.ioDefined) for (const k of Object.keys(AVR.BITS)) cands.push(k);
      for (const k of Object.keys(BUILTINS)) cands.push(k);
      for (const k of this.funcs.keys()) cands.push(k);
      let best = null, bd = 99;
      for (const c of cands) { const d = levenshtein(c, name); if (d < bd) { bd = d; best = c; } }
      const hint = best && bd <= (name.length >= 4 ? 2 : 1) ? ' – meintest du "' + best + '"?' : '';
      this.err('"' + name + '" wurde nicht deklariert' + hint, n);
    }

    ex(n) {
      const t = this.ex0(n);
      if (!n.g) n.g = !!((n.a && n.a.g) || (n.b && n.b.g) || (n.c && n.c.g) || (n.i && n.i.g) || (n.args && n.args.some(a => a.g)));
      return t;
    }
    ex0(n) {
      switch (n.k) {
        case 'num': return n.type;
        case 'str': {
          const store = { t: TY.i8, d: n.v.map(c => c > 127 ? c - 256 : c).concat([0]), name: 'Zeichenkette', type: arrT(TY.i8, n.v.length + 1) };
          this.strings.push(store);
          n.ptr = { s: store, i: 0 };
          n.type = PCHAR;
          return n.type;
        }
        case 'id': {
          const s = this.lookup(n.name);
          if (!s) this.unknownId(n);
          if (s.kind === 'io') { n.io = s.name; n.type = s.type; return n.type; }
          if (s.kind === 'func') this.err('"' + n.name + '" ist eine Funktion – Aufruf mit ' + n.name + '()', n);
          n.sym = s; n.type = s.type;
          if (s.global || s.static) n.gsym = s; else n.slot = s.slot;
          return n.type;
        }
        case 'un': {
          const t = this.ex(n.a);
          if (n.op === '!') { if (t.k === 'void') this.err('Wert erwartet', n.a); n.type = TY.i16; return n.type; }
          if (!isArith(t)) this.err('Operator "' + n.op + '" braucht eine Zahl', n);
          if (n.op === '~' && t.k === 'float') this.err('"~" geht nur mit ganzen Zahlen', n);
          n.type = promote(t); n.w = wrapOf(n.type);
          if (n.a.k === 'num') { // Konstante zusammenfassen
            const a = n.a.v;
            const v = n.op === '-' ? (n.type.k === 'float' ? -a : n.w(-a)) : n.op === '~' ? n.w(~a) : a;
            Object.assign(n, { k: 'num', v });
          }
          return n.type;
        }
        case 'pre': case 'post': {
          const t = this.ex(n.a);
          this.lvalue(n.a, n.op);
          if (!(isArith(t) || t.k === 'ptr')) this.err('"' + n.op + '" geht nur mit Zahlen oder Zeigern', n);
          n.type = t;
          const d = n.op === '++' ? 1 : -1;
          if (t.k === 'ptr') { const st = cells(t.to); n.inc = v => (v ? { s: v.s, i: v.i + d * st } : v); }
          else if (t.k === 'float') n.inc = v => Math.fround(v + d);
          else { const w = wrapOf(t); n.inc = t.k === 'bool' ? (v => (d > 0 ? 1 : (v ? 0 : 1))) : (v => w(v + d)); }
          return t;
        }
        case 'addr': {
          const t = this.ex(n.a);
          if (n.a.k === 'id' && n.a.io) { n.type = ptrT(t); return n.type; }
          if (!(n.a.k === 'id' || n.a.k === 'idx' || n.a.k === 'deref')) this.err('"&" braucht eine Variable', n);
          n.type = ptrT(t.k === 'arr' ? t.of : t);
          return n.type;
        }
        case 'deref': {
          const t = this.ex(n.a);
          if (!isPtrLike(t)) this.err('"*" braucht einen Zeiger', n);
          n.type = t.k === 'ptr' ? t.to : t.of;
          if (n.type.k === 'void') this.err('void-Zeiger kann nicht dereferenziert werden', n);
          n.st = cells(n.type);
          return n.type;
        }
        case 'idx': {
          const ta = this.ex(n.a), ti = this.ex(n.i);
          if (!isPtrLike(ta)) {
            if (isPtrLike(ti)) this.err('Schreibweise i[array] wird nicht unterstützt – benutze array[i]', n);
            this.err((n.a.name ? '"' + n.a.name + '"' : 'Ausdruck') + ' ist kein Array', n);
          }
          if (!isInt(ti)) this.err('Array-Index muss eine ganze Zahl sein', n.i);
          n.type = ta.k === 'ptr' ? ta.to : ta.of;
          n.st = cells(n.type);
          n.iw = wrapOf(promote(ti));
          if (ta.k === 'arr' && ta.n && n.i.k === 'num' && (n.i.v < 0 || n.i.v >= ta.n)) this.warn('Index ' + n.i.v + ' liegt außerhalb des Arrays (0 … ' + (ta.n - 1) + ')', n);
          return n.type;
        }
        case 'cast': {
          const t = this.ex(n.a);
          if (n.to.k === 'arr') this.err('Cast in einen Array-Typ nicht erlaubt', n);
          if (isArith(n.to) && isPtrLike(t)) this.warn('Zeiger wird in eine Zahl umgewandelt', n);
          n.type = n.to; n.cv = wrapOf(n.to);
          if (n.to.k === 'ptr' && isArith(t)) n.cv = v => (v === 0 ? null : v);
          return n.type;
        }
        case 'sizeof': {
          let size;
          if (n.to) size = sizeOf(n.to);
          else { const t = this.ex(n.a); size = sizeOf(t); }
          Object.assign(n, { k: 'num', v: size, type: TY.u16 });
          delete n.a;
          return n.type;
        }
        case 'comma': this.ex(n.a); n.type = this.ex(n.b); n.g = n.a.g || n.b.g; return n.type;
        case 'cond': {
          this.cond(n.c);
          const a = this.ex(n.a), b = this.ex(n.b);
          if (isArith(a) && isArith(b)) n.type = usual(a, b);
          else if (a.k === 'void' || b.k === 'void') n.type = TY.void;
          else n.type = decay(isPtrLike(a) ? a : b);
          n.cv = wrapOf(n.type);
          n.g = n.c.g || n.a.g || n.b.g;
          return n.type;
        }
        case 'bin': return this.binary(n);
        case 'asg': {
          const ta = this.ex(n.a), tb = this.ex(n.b);
          this.lvalue(n.a, n.op);
          if (n.op === '=') {
            this.checkAssign(ta, n.b, n);
            if (ta.k === 'ptr' && tb.k !== 'void') n.cv = W.p;
            else n.cv = wrapOf(ta);
          } else {
            const op = n.op.slice(0, -1);
            const pseudo = { k: 'bin', op, a: { type: ta }, b: { type: tb }, line: n.line, col: n.col };
            this.binType(pseudo);
            n.bop = pseudo;
            n.cv = wrapOf(ta);
          }
          n.type = ta;
          n.g = n.a.g || n.b.g;
          return ta;
        }
        case 'call': return this.call(n);
      }
      this.err('Unbekannter Ausdruck', n);
    }

    binary(n) {
      this.ex(n.a); this.ex(n.b);
      if (n.a.type.k === 'void' || n.b.type.k === 'void') this.err('Ausdruck hat keinen Wert (void)', n);
      this.binType(n);
      n.g = n.a.g || n.b.g;
      // Konstanten falten
      if (n.a.k === 'num' && n.b.k === 'num' && !n.pk && n.op !== '/' && n.op !== '%') {
        const v = binop(n, n.a.v, n.b.v);
        if (n.ct && n.ct.k === 'int' && ['+', '-', '*', '<<'].includes(n.op)) {
          const exact = n.op === '+' ? n.a.v + n.b.v : n.op === '-' ? n.a.v - n.b.v : n.op === '*' ? n.a.v * n.b.v : n.a.v * Math.pow(2, n.b.v);
          if (exact !== v) {
            this.warn('Überlauf: ' + n.a.v + ' ' + n.op + ' ' + n.b.v + ' = ' + exact + ' passt nicht in ' + n.ct.name + ' (' + n.ct.bits + ' Bit), Ergebnis wird ' + v + '. Tipp: mit UL rechnen, z. B. ' + n.a.v + 'UL ' + n.op + ' ' + n.b.v, n);
          }
        }
        Object.assign(n, { k: 'num', v, folded: true });
      }
      return n.type;
    }

    binType(n) {
      const a = n.a.type, b = n.b.type, op = n.op;
      n.pk = null;
      switch (op) {
        case '+': case '-':
          if (isPtrLike(a) && isInt(b)) { n.pk = op === '+' ? 'pi' : 'pmi'; n.st = cells(a.k === 'ptr' ? a.to : a.of); n.type = decay(a); return; }
          if (op === '+' && isInt(a) && isPtrLike(b)) { n.pk = 'ip'; n.st = cells(b.k === 'ptr' ? b.to : b.of); n.type = decay(b); return; }
          if (op === '-' && isPtrLike(a) && isPtrLike(b)) { n.pk = 'pp'; n.st = cells(a.k === 'ptr' ? a.to : a.of) || 1; n.type = TY.i16; return; }
        // fallthrough
        case '*': case '/':
          if (!isArith(a) || !isArith(b)) this.err('Operator "' + op + '" braucht Zahlen', n);
          n.ct = usual(a, b); n.type = n.ct; break;
        case '%': case '&': case '|': case '^':
          if (!isInt(a) || !isInt(b)) this.err('Operator "' + op + '" geht nur mit ganzen Zahlen', n);
          n.ct = usual(a, b); n.type = n.ct; break;
        case '<<': case '>>':
          if (!isInt(a) || !isInt(b)) this.err('Operator "' + op + '" geht nur mit ganzen Zahlen', n);
          n.ct = promote(a); n.type = n.ct;
          if (n.b.k === 'num' && n.b.v >= n.ct.bits) this.warn('Verschiebung um ' + n.b.v + ' Bit ist zu groß für ' + n.ct.name + ' (' + n.ct.bits + ' Bit) – benutze z. B. 1UL << ' + n.b.v, n);
          break;
        case '<': case '>': case '<=': case '>=': case '==': case '!=':
          if (isPtrLike(a) || isPtrLike(b)) { n.pk = 'cmp'; n.type = TY.i16; return; }
          if (!isArith(a) || !isArith(b)) this.err('Vergleich braucht Zahlen', n);
          n.ct = usual(a, b); n.type = TY.i16;
          if (n.ct.k === 'int' && !n.ct.s && a.k !== b.k) { /* */ }
          if (n.ct.k === 'int' && n.ct.s === false && ((n.a.k === 'num' && n.a.v < 0) || (n.b.k === 'num' && n.b.v < 0))) this.warn('Vergleich einer vorzeichenlosen Zahl mit einem negativen Wert', n);
          break;
        case '&&': case '||': n.type = TY.i16; return;
        default: this.err('Unbekannter Operator ' + op, n);
      }
      n.w = wrapOf(n.ct);
      n.fl = n.ct.k === 'float';
      n.sg = n.ct.s;
      n.b32 = n.ct.bits === 32;
    }

    call(n) {
      const s = this.lookup(n.name);
      const bi = BUILTINS[n.name];
      if (bi && (!s || s.kind !== 'func')) {
        n.bi = n.name;
        if (!this.ctx.includes.has(bi.inc)) {
          this.ctx.warnOnce('inc_' + bi.inc, 'Für ' + n.name + '() fehlt #include <' + bi.inc + '>', n.line);
        }
        if (n.args.length !== bi.params.length) this.err(n.name + '() erwartet ' + bi.params.length + ' Argument(e), nicht ' + n.args.length, n);
        n.args.forEach((a, i) => { this.ex(a); this.checkAssign(bi.params[i], a, n); });
        n.pcv = bi.params.map(wrapOf);
        n.type = bi.ret; n.g = !!bi.g || n.args.some(a => a.g);
        if ((n.name === '_delay_ms' || n.name === '_delay_us') && n.args[0].k !== 'num') {
          this.ctx.warnOnce('delayvar', n.name + '() mit einer Variablen: Beim echten avr-gcc muss hier eine Konstante stehen! Tipp: for-Schleife mit _delay_ms(1).', n.line);
        }
        if (n.name === '_delay_ms' && n.args[0].k === 'num' && n.args[0].v > 6553) this.warn('_delay_ms(' + n.args[0].v + '): Werte über 6553 ms werden beim echten Chip ungenau', n);
        return n.type;
      }
      if (!s) {
        const f = this.funcs.get(n.name);
        if (f) {
          this.warn('Funktion "' + n.name + '" wird benutzt, bevor sie deklariert ist – schreibe die Funktion über main oder füge einen Prototyp ein', n);
          return this.callUser(n, f);
        }
        const all = [...this.funcs.keys(), ...Object.keys(BUILTINS)];
        let best = null, bd = 99;
        for (const c of all) { const d = levenshtein(c, n.name); if (d < bd) { bd = d; best = c; } }
        this.err('Funktion "' + n.name + '" ist unbekannt' + (best && bd <= 3 ? ' – meintest du "' + best + '"?' : ''), n);
      }
      if (s.kind !== 'func') this.err('"' + n.name + '" ist keine Funktion', n);
      return this.callUser(n, s.f);
    }
    callUser(n, f) {
      if (n.args.length !== f.params.length) this.err('"' + n.name + '" erwartet ' + f.params.length + ' Argument(e), nicht ' + n.args.length, n);
      n.args.forEach((a, i) => { this.ex(a); this.checkAssign(f.params[i].type, a, n); });
      n.fn = f; f.used = true;
      n.type = f.ret; n.g = true;
      return n.type;
    }
  }

  // Binäre Operation (gemeinsam für Konstantenfaltung und VM)
  function binop(n, x, y) {
    switch (n.pk) {
      case 'pi': return x ? { s: x.s, i: x.i + y * n.st } : x;
      case 'pmi': return x ? { s: x.s, i: x.i - y * n.st } : x;
      case 'ip': return y ? { s: y.s, i: y.i + x * n.st } : y;
      case 'pp': return ((x ? x.i : 0) - (y ? y.i : 0)) / n.st;
      case 'cmp': {
        const a = x && typeof x === 'object' ? x.i : (x ? x : -1), b = y && typeof y === 'object' ? y.i : (y ? y : -1);
        const sa = x && x.s, sb = y && y.s;
        switch (n.op) {
          case '==': return (x === y || (sa === sb && a === b)) ? 1 : 0;
          case '!=': return (x === y || (sa === sb && a === b)) ? 0 : 1;
          case '<': return +(a < b); case '>': return +(a > b); case '<=': return +(a <= b); case '>=': return +(a >= b);
        }
      }
    }
    const w = n.w;
    switch (n.op) {
      case '+': return w(x + y);
      case '-': return w(x - y);
      case '*': return n.b32 ? w(Math.imul(x, y)) : w(x * y);
      case '/': {
        if (n.fl) return w(x / y);
        x = w(x); y = w(y);
        if (y === 0) throw new RuntimeError('Division durch 0');
        return w(Math.trunc(x / y));
      }
      case '%': {
        x = w(x); y = w(y);
        if (y === 0) throw new RuntimeError('Division durch 0 (Modulo %)');
        return w(x % y);
      }
      case '&': return w(x & y);
      case '|': return w(x | y);
      case '^': return w(x ^ y);
      case '<<': y = y | 0; return (y >= 32 || y < 0) ? 0 : w(w(x) << y);
      case '>>': y = y | 0; x = w(x); if (y >= 32 || y < 0) return n.sg && x < 0 ? -1 : 0; return n.sg ? w(x >> y) : w(x >>> y);
      case '<': return n.fl ? +(x < y) : +(w(x) < w(y));
      case '>': return n.fl ? +(x > y) : +(w(x) > w(y));
      case '<=': return n.fl ? +(x <= y) : +(w(x) <= w(y));
      case '>=': return n.fl ? +(x >= y) : +(w(x) >= w(y));
      case '==': return n.fl ? +(x === y) : +(w(x) === w(y));
      case '!=': return n.fl ? +(x !== y) : +(w(x) !== w(y));
      case '&&': return (x && y) ? 1 : 0;
      case '||': return (x || y) ? 1 : 0;
    }
    throw new RuntimeError('Operator ' + n.op);
  }

  class RuntimeError extends Error {
    constructor(msg, line) { super(msg); this.line = line; }
  }

  // =====================================================================
  // Öffentliche Schnittstelle
  // =====================================================================
  function compile(src) {
    const warnings = [];
    const onceKeys = new Set();
    const ctx = {
      macros: new Map(), includes: new Set(), enums: new Map(), ioDefined: false, delayFcpuAtInclude: null,
      warn(msg, line) { if (!warnings.some(w => w.msg === msg && w.line === line)) warnings.push({ msg, line: line || 0 }); },
      warnOnce(key, msg, line) { if (onceKeys.has(key)) return; onceKeys.add(key); this.warn(msg, line); },
      macroValue(name) {
        const m = this.macros.get(name);
        if (!m || m.params) return null;
        try {
          const toks = expand(m.body.map(t => Object.assign({}, t)), this.macros);
          const p = new Parser(toks, this);
          return p.constEval(p.parseExpr());
        } catch (e) { return null; }
      },
    };
    const pre = preprocess(src, ctx);
    let toks = lex(pre, 1);
    toks = expand(toks, ctx.macros);
    const parser = new Parser(toks, ctx);
    const items = parser.parseProgram();
    const an = new Analyzer(items, ctx);
    const prog = an.run();
    prog.warnings = warnings.sort((a, b) => a.line - b.line);
    prog.fcpu = ctx.macroValue('F_CPU');
    prog.delayFcpu = ctx.delayFcpuAtInclude != null ? ctx.delayFcpuAtInclude : prog.fcpu;
    prog.includes = ctx.includes;
    return prog;
  }

  G.CCompiler = { compile, CompileError, RuntimeError, TY, binop, wrapOf, cells, sizeOf, BUILTINS, typeName };
})(typeof window !== 'undefined' ? window : globalThis);
