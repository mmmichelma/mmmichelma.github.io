/* Ausführung des übersetzten C-Programms.
 * Jede Anweisung liefert per "yield" die Kontrolle zurück -> Pause, Einzelschritt,
 * Haltepunkte und Echtzeit-Takt sind dadurch einfach möglich.
 */
(function (G) {
  'use strict';
  const { RuntimeError, binop, cells } = G.CCompiler;
  const VECTORS = G.ATmega8.VECTORS;

  const IOS = { io: true, name: 'Register', d: [] };
  const DELAY = { delay: true };
  const BRK = 1, CNT = 2, RET = 3;
  const truth = v => (typeof v === 'number' ? v !== 0 : !!v);

  function scalarBase(t) { while (t.k === 'arr') t = t.of; return t; }

  class VM {
    constructor(prog, mcu, opts) {
      this.prog = prog;
      this.mcu = mcu;
      this.opts = opts || {};
      this.delayHz = prog.delayFcpu || 1000000;
      this.reset();
    }

    reset() {
      this.mcu.reset();
      this.stack = [];
      this.finished = false;
      this.cur = null;
      this.horizon = Infinity;
      this.retv = 0;
      this.seed = 1;
      this.isrCount = new Array(VECTORS.length).fill(0);
      this.ls = null; this.li = 0;
      for (const s of this.prog.statics) s.store = null;
      for (const g of this.prog.globals) {
        const z = g.store.t.k === 'ptr' ? null : 0;
        g.store.d.fill(z);
      }
      for (const g of this.prog.globals) if (g.init) this.initSync(g.store, g.init);
      this.gen = this.run();
    }

    get cycles() { return this.mcu.cycles; }
    tick(n) { this.mcu.advance(n); }

    newStore(type, name) {
      const base = scalarBase(type);
      const n = cells(type);
      const d = new Array(n).fill(base.k === 'ptr' ? null : 0);
      return { t: base, d, name, type };
    }
    initSync(store, init) {
      if (init.e) store.d[0] = init.cv(this.ev(init.e, null));
      else for (const c of init.cellsInit) store.d[c.i] = init.cv(this.ev(c.e, null));
    }
    *initG(store, init, f) {
      if (init.e) store.d[0] = init.cv(init.e.g ? (yield* this.evG(init.e, f)) : this.ev(init.e, f));
      else for (const c of init.cellsInit) store.d[c.i] = init.cv(c.e.g ? (yield* this.evG(c.e, f)) : this.ev(c.e, f));
    }

    *run() {
      this.tick(30); // Start-Code (Stack, .data/.bss)
      yield* this.callFn(this.prog.main, []);
      this.finished = true;
    }

    *callFn(fn, args) {
      if (this.stack.length >= 60) throw new RuntimeError('Stapelüberlauf: zu viele verschachtelte Funktionsaufrufe (Rekursion ohne Ende?). Der ATmega8 hat nur 1 KB RAM.');
      const f = { fn, vars: new Array(fn.nslots), line: fn.line };
      for (let i = 0; i < args.length; i++) {
        const p = fn.params[i];
        f.vars[i] = { t: p.type, d: [args[i]], name: p.name, type: p.type };
      }
      this.stack.push(f);
      this.tick(4);
      const r = yield* this.exec(fn.body, f);
      this.stack.pop();
      this.tick(4);
      return r === RET ? this.retv : 0;
    }

    *irq() {
      const mcu = this.mcu;
      const v = mcu.pending();
      if (v < 0) { mcu.updateIrq(); return; }
      const fn = this.prog.isrs.get(v);
      if (!fn) {
        throw new RuntimeError('Der Interrupt ' + VECTORS[v] + ' ist freigegeben, aber es gibt keine Funktion ISR(' + VECTORS[v] + ') { ... }. Der echte ATmega8 würde jetzt immer wieder neu starten (Reset).');
      }
      mcu.ack(v);
      mcu.sreg &= ~0x80; mcu.updateIrq();
      this.isrCount[v]++;
      this.tick(4);
      yield* this.callFn(fn, []);
      this.tick(4);
      mcu.sreg |= 0x80; mcu.updateIrq(); // reti
    }

    *delay(c) {
      const mcu = this.mcu;
      const end = mcu.cycles + c;
      while (mcu.cycles < end) {
        let next = end;
        if (this.horizon < next) next = this.horizon;
        if (mcu.busy) { const ne = mcu.nextEvent(); if (ne < next) next = ne; }
        if (next > mcu.cycles) mcu.advance(next - mcu.cycles);
        if (mcu.irq) yield* this.irq();
        if (mcu.cycles < end) yield DELAY;
      }
    }

    // ---------------- Anweisungen ----------------
    *exec(s, f) {
      switch (s.k) {
        case 'expr':
          f.line = s.line; yield s; if (this.mcu.irq) yield* this.irq();
          this.tick(s.c);
          if (s.e.g) yield* this.evG(s.e, f); else this.ev(s.e, f);
          return 0;
        case 'block': {
          const b = s.body;
          for (let i = 0; i < b.length; i++) { const r = yield* this.exec(b[i], f); if (r) return r; }
          return 0;
        }
        case 'decl':
          f.line = s.line; yield s; if (this.mcu.irq) yield* this.irq();
          this.tick(s.c);
          for (const v of s.vars) {
            const sym = v.sym;
            if (sym.static) {
              if (sym.store) continue;
              sym.store = this.newStore(v.ty, v.name);
              if (v.initD) yield* this.initG(sym.store, v.initD, f);
              continue;
            }
            const st = this.newStore(v.ty, v.name);
            f.vars[sym.slot] = st;
            if (v.initD) yield* this.initG(st, v.initD, f);
          }
          return 0;
        case 'if': {
          f.line = s.line; yield s; if (this.mcu.irq) yield* this.irq();
          this.tick(s.c2);
          const c = s.c.g ? (yield* this.evG(s.c, f)) : this.ev(s.c, f);
          if (truth(c)) return yield* this.exec(s.t, f);
          if (s.e) return yield* this.exec(s.e, f);
          return 0;
        }
        case 'while':
          if (s.idle) return yield* this.idle(s, f);
          for (;;) {
            f.line = s.line; yield s; if (this.mcu.irq) yield* this.irq();
            this.tick(s.c2);
            const c = s.c.g ? (yield* this.evG(s.c, f)) : this.ev(s.c, f);
            if (!truth(c)) return 0;
            const r = yield* this.exec(s.b, f);
            if (r === BRK) return 0;
            if (r === RET) return r;
          }
        case 'do': {
          if (!s.wn) s.wn = { k: 'dowhile', line: s.wline };
          for (;;) {
            const r = yield* this.exec(s.b, f);
            if (r === BRK) return 0;
            if (r === RET) return r;
            f.line = s.wline; yield s.wn; if (this.mcu.irq) yield* this.irq();
            this.tick(s.c2);
            const c = s.c.g ? (yield* this.evG(s.c, f)) : this.ev(s.c, f);
            if (!truth(c)) return 0;
          }
        }
        case 'for': {
          if (s.init) {
            if (s.init.k === 'decl') yield* this.exec(s.init, f);
            else { f.line = s.line; this.tick(1); if (s.init.e.g) yield* this.evG(s.init.e, f); else this.ev(s.init.e, f); }
          }
          if (s.idle) return yield* this.idle(s, f);
          for (;;) {
            f.line = s.line; yield s; if (this.mcu.irq) yield* this.irq();
            this.tick(s.c2);
            if (s.c) {
              const c = s.c.g ? (yield* this.evG(s.c, f)) : this.ev(s.c, f);
              if (!truth(c)) return 0;
            }
            const r = yield* this.exec(s.b, f);
            if (r === BRK) return 0;
            if (r === RET) return r;
            if (s.step) { if (s.step.g) yield* this.evG(s.step, f); else this.ev(s.step, f); }
          }
        }
        case 'switch': {
          f.line = s.line; yield s; if (this.mcu.irq) yield* this.irq();
          this.tick(s.c2);
          const v = s.cv(s.c.g ? (yield* this.evG(s.c, f)) : this.ev(s.c, f));
          let idx = s.map.get(v);
          if (idx === undefined) idx = s.def;
          if (idx < 0) return 0;
          const b = s.b.body;
          for (let i = idx; i < b.length; i++) {
            const r = yield* this.exec(b[i], f);
            if (r === BRK) return 0;
            if (r) return r;
          }
          return 0;
        }
        case 'case': case 'default': case 'empty': return 0;
        case 'break': f.line = s.line; yield s; this.tick(1); return BRK;
        case 'continue': f.line = s.line; yield s; this.tick(1); return CNT;
        case 'return':
          f.line = s.line; yield s; if (this.mcu.irq) yield* this.irq();
          this.tick(s.c);
          this.retv = s.e ? s.cv(s.e.g ? (yield* this.evG(s.e, f)) : this.ev(s.e, f)) : 0;
          return RET;
      }
      throw new RuntimeError('Interner Fehler: Anweisung ' + s.k);
    }

    // Leere Endlosschleife (while(1){}): bis zum nächsten Ereignis vorspulen
    *idle(s, f) {
      const mcu = this.mcu;
      for (;;) {
        f.line = s.line; yield s; if (mcu.irq) yield* this.irq();
        let next = this.horizon;
        if (mcu.busy) { const ne = mcu.nextEvent(); if (ne < next) next = ne; }
        if (next !== Infinity && next > mcu.cycles + s.c2) mcu.advance(Math.ceil((next - mcu.cycles) / 3) * 3);
        else this.tick(s.c2 || 2);
      }
    }

    // ---------------- Speicherzugriff ----------------
    rd(s, i) { return s === IOS ? this.mcu.read(i) : s.d[i]; }
    wr(s, i, v) { if (s === IOS) this.mcu.write(i, v); else s.d[i] = v; }

    setPtr(p) {
      if (!p || typeof p !== 'object') throw new RuntimeError('Zeiger zeigt ins Leere (NULL / nicht gesetzt)');
      this.ls = p.s; this.li = p.i;
      if (p.s !== IOS && (p.i < 0 || p.i >= p.s.d.length)) throw new RuntimeError('Zeiger zeigt außerhalb von "' + p.s.name + '"');
    }
    index(n, i) {
      if (this.ls === IOS) throw new RuntimeError('Mit Register-Zeigern kann man nicht rechnen');
      const at = n.a.type;
      if (at.k === 'arr' && at.n && (i < 0 || i >= at.n)) {
        throw new RuntimeError('Array-Index ' + i + ' liegt außerhalb von "' + (n.a.name || this.ls.name) + '" (gültig: 0 … ' + (at.n - 1) + ')');
      }
      const li = this.li + i * n.st;
      if (li < 0 || li + n.st > this.ls.d.length) throw new RuntimeError('Zugriff außerhalb von "' + this.ls.name + '" (Index ' + i + ')');
      this.li = li;
    }
    lv(n, f) {
      switch (n.k) {
        case 'id':
          if (n.io) { this.ls = IOS; this.li = n.io; return; }
          this.ls = n.gsym ? n.gsym.store : f.vars[n.slot]; this.li = 0;
          if (!this.ls) throw new RuntimeError('Variable "' + n.name + '" wird benutzt, bevor sie angelegt wurde');
          return;
        case 'idx': {
          const i = n.iw(this.ev(n.i, f));
          if (n.a.type.k === 'arr') this.lv(n.a, f); else this.setPtr(this.ev(n.a, f));
          this.index(n, i);
          return;
        }
        case 'deref': this.setPtr(this.ev(n.a, f)); return;
      }
      throw new RuntimeError('Hier wird eine Variable erwartet');
    }
    *lvG(n, f) {
      switch (n.k) {
        case 'idx': {
          const i = n.iw(n.i.g ? (yield* this.evG(n.i, f)) : this.ev(n.i, f));
          if (n.a.type.k === 'arr') { if (n.a.g) yield* this.lvG(n.a, f); else this.lv(n.a, f); }
          else this.setPtr(n.a.g ? (yield* this.evG(n.a, f)) : this.ev(n.a, f));
          this.index(n, i);
          return;
        }
        case 'deref': this.setPtr(yield* this.evG(n.a, f)); return;
      }
      this.lv(n, f);
    }
    assign(n, s, i, v) {
      if (n.op === '=') { v = n.cv(v); this.wr(s, i, v); return v; }
      const r = n.cv(binop(n.bop, this.rd(s, i), v));
      this.wr(s, i, r);
      return r;
    }
    incdec(n, s, i) {
      const old = this.rd(s, i);
      const nv = n.inc(old);
      this.wr(s, i, nv);
      return n.k === 'pre' ? nv : old;
    }

    // ---------------- Ausdrücke (ohne Funktionsaufrufe) ----------------
    ev(n, f) {
      switch (n.k) {
        case 'num': return n.v;
        case 'id': {
          if (n.io) return this.mcu.read(n.io);
          const st = n.gsym ? n.gsym.store : f.vars[n.slot];
          if (!st) throw new RuntimeError('Variable "' + n.name + '" wird benutzt, bevor sie angelegt wurde');
          if (n.type.k === 'arr') return { s: st, i: 0 };
          return st.d[0];
        }
        case 'str': return n.ptr;
        case 'bin':
          if (n.op === '&&') return (truth(this.ev(n.a, f)) && truth(this.ev(n.b, f))) ? 1 : 0;
          if (n.op === '||') return (truth(this.ev(n.a, f)) || truth(this.ev(n.b, f))) ? 1 : 0;
          return binop(n, this.ev(n.a, f), this.ev(n.b, f));
        case 'un': {
          const x = this.ev(n.a, f);
          switch (n.op) {
            case '-': return n.w(-x);
            case '+': return n.w(x);
            case '~': return n.w(~x);
            default: return truth(x) ? 0 : 1;
          }
        }
        case 'asg': {
          const v = this.ev(n.b, f);
          this.lv(n.a, f);
          return this.assign(n, this.ls, this.li, v);
        }
        case 'pre': case 'post':
          this.lv(n.a, f);
          return this.incdec(n, this.ls, this.li);
        case 'cond': return truth(this.ev(n.c, f)) ? n.cv(this.ev(n.a, f)) : n.cv(this.ev(n.b, f));
        case 'idx': case 'deref':
          this.lv(n, f);
          if (n.type.k === 'arr') return { s: this.ls, i: this.li };
          return this.rd(this.ls, this.li);
        case 'addr':
          if (n.a.k === 'id' && n.a.io) return { s: IOS, i: n.a.io };
          this.lv(n.a, f);
          return { s: this.ls, i: this.li };
        case 'cast': return n.cv(this.ev(n.a, f));
        case 'comma': this.ev(n.a, f); return this.ev(n.b, f);
        case 'call': {
          const args = n.args.map((a, i) => n.pcv[i](this.ev(a, f)));
          return this.builtin(n.bi, args);
        }
      }
      throw new RuntimeError('Interner Fehler: Ausdruck ' + n.k);
    }

    // ---------------- Ausdrücke mit Funktionsaufrufen ----------------
    *evG(n, f) {
      switch (n.k) {
        case 'call': {
          const args = [];
          const pcv = n.bi ? n.pcv : n.fn.pcv;
          for (let i = 0; i < n.args.length; i++) {
            const a = n.args[i];
            args.push(pcv[i](a.g ? (yield* this.evG(a, f)) : this.ev(a, f)));
          }
          if (n.bi) {
            if (n.bi === '_delay_ms') { yield* this.delay(Math.max(0, args[0]) * this.delayHz / 1000); return 0; }
            if (n.bi === '_delay_us') { yield* this.delay(Math.max(0, args[0]) * this.delayHz / 1e6); return 0; }
            return this.builtin(n.bi, args);
          }
          this.tick(2 + args.length);
          return n.fn.retCv(yield* this.callFn(n.fn, args));
        }
        case 'bin': {
          if (n.op === '&&') return (truth(yield* this.evG2(n.a, f)) && truth(yield* this.evG2(n.b, f))) ? 1 : 0;
          if (n.op === '||') return (truth(yield* this.evG2(n.a, f)) || truth(yield* this.evG2(n.b, f))) ? 1 : 0;
          const x = yield* this.evG2(n.a, f);
          const y = yield* this.evG2(n.b, f);
          return binop(n, x, y);
        }
        case 'un': {
          const x = yield* this.evG(n.a, f);
          switch (n.op) {
            case '-': return n.w(-x);
            case '+': return n.w(x);
            case '~': return n.w(~x);
            default: return truth(x) ? 0 : 1;
          }
        }
        case 'asg': {
          const v = yield* this.evG2(n.b, f);
          if (n.a.g) yield* this.lvG(n.a, f); else this.lv(n.a, f);
          return this.assign(n, this.ls, this.li, v);
        }
        case 'pre': case 'post':
          yield* this.lvG(n.a, f);
          return this.incdec(n, this.ls, this.li);
        case 'cond': {
          const c = yield* this.evG2(n.c, f);
          return truth(c) ? n.cv(yield* this.evG2(n.a, f)) : n.cv(yield* this.evG2(n.b, f));
        }
        case 'idx': case 'deref':
          yield* this.lvG(n, f);
          if (n.type.k === 'arr') return { s: this.ls, i: this.li };
          return this.rd(this.ls, this.li);
        case 'addr':
          yield* this.lvG(n.a, f);
          return { s: this.ls, i: this.li };
        case 'cast': return n.cv(yield* this.evG(n.a, f));
        case 'comma': yield* this.evG2(n.a, f); return yield* this.evG2(n.b, f);
      }
      return this.ev(n, f);
    }
    *evG2(n, f) { return n.g ? (yield* this.evG(n, f)) : this.ev(n, f); }

    // ---------------- Eingebaute Funktionen ----------------
    builtin(name, a) {
      const mcu = this.mcu;
      switch (name) {
        case 'sei': mcu.sreg |= 0x80; mcu.updateIrq(); this.tick(1); return 0;
        case 'cli': mcu.sreg &= ~0x80; mcu.updateIrq(); this.tick(1); return 0;
        case '_NOP': this.tick(1); return 0;
        case 'wdt_reset': this.tick(1); return 0;
        case 'abs': return Math.abs(a[0]) & 0xFFFF;
        case 'labs': return Math.abs(a[0]) | 0;
        case 'rand': this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0; this.tick(40); return (this.seed >>> 16) & 0x7FFF;
        case 'srand': this.seed = a[0] >>> 0; return 0;
        case 'itoa': case 'utoa': case 'ltoa': case 'ultoa': {
          const p = a[1];
          if (!p || typeof p !== 'object' || p.s === IOS) throw new RuntimeError(name + '(): zweites Argument muss ein char-Array sein');
          const base = a[2];
          if (base < 2 || base > 36) throw new RuntimeError(name + '(): Basis muss zwischen 2 und 36 liegen');
          let v = a[0];
          let str = (base === 10 || v >= 0) ? v.toString(base) : (name === 'ltoa' ? (v >>> 0) : (v & 0xFFFF)).toString(base);
          const codes = Array.from(str, ch => ch.charCodeAt(0));
          codes.push(0);
          if (p.i + codes.length > p.s.d.length) throw new RuntimeError(name + '(): Das char-Array "' + p.s.name + '" ist zu klein für "' + str + '" (braucht ' + codes.length + ' Zeichen inkl. \\0)');
          codes.forEach((c, k) => { p.s.d[p.i + k] = c; });
          this.tick(60 + 20 * codes.length);
          return p;
        }
        case 'strlen': {
          const p = a[0];
          if (!p || typeof p !== 'object') throw new RuntimeError('strlen(): Zeiger ist NULL');
          let n = 0;
          while (p.i + n < p.s.d.length && p.s.d[p.i + n] !== 0) n++;
          this.tick(4 + 4 * n);
          return n;
        }
      }
      throw new RuntimeError('Unbekannte Funktion ' + name);
    }

    // ---------------- Für die Anzeige ----------------
    frames() { return this.stack.slice(); }
    get line() { const f = this.stack[this.stack.length - 1]; return f ? f.line : 0; }
  }

  VM.DELAY = DELAY;
  VM.IOS = IOS;
  G.AvrVM = VM;
})(typeof window !== 'undefined' ? window : globalThis);
