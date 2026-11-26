/* Die simulierte Schaltung: ATmega8 (DIP-28), Schrittmotor mit Treiber,
 * Taster, Potentiometer, LED-Zeile und Logikanalysator.
 */
(function (G) {
  'use strict';
  const AVR = G.ATmega8;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const PORT_IDX = { B: 0, C: 1, D: 2 };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function parsePin(name) {
    const m = /^P([BCD])([0-7])$/.exec(name || '');
    return m ? { p: PORT_IDX[m[1]], b: +m[2], name } : null;
  }

  const MOTORS = {
    '28byj': { label: '28BYJ-48 (5 V, Getriebe 1:64)', steps: 2048, maxRate: 650 },
    'nema17': { label: 'NEMA 17 (1,8° pro Schritt)', steps: 200, maxRate: 1200 },
    'pm48': { label: 'Kleiner Motor (7,5° pro Schritt)', steps: 48, maxRate: 400 },
  };

  const DEFAULT_CFG = {
    motor: '28byj', steps: 2048, maxRate: 650, driver: 'uln',
    mpins: ['PB0', 'PB1', 'PB2', 'PB3'],
    s1: 'PD2', s2: 'PD3', extPullup: false,
    ledPort: 'D', potCh: 0, clock: 'auto',
  };

  // =====================================================================
  // Schrittmotor-Modell
  // =====================================================================
  class Stepper {
    constructor() { this.cfg = DEFAULT_CFG; this.reset(); }
    configure(cfg) { this.cfg = cfg; this.vmax = cfg.maxRate * 90; this.angles = cfg.driver === 'l293' ? [0, 180, 90, 270] : [0, 90, 180, 270]; this.fieldAngle = this.field(this.coils); }
    reset() {
      this.theta = 0; this.coils = 0; this.t = 0; this.fieldAngle = null;
      this.hist = [[0, 0]]; this.samples = []; this.lagT = -10; this.missed = 0; this.steps = 0;
      this.lastField = null;
      this.zero = 0; this.started = false;
    }
    field(c) {
      if (!this.angles) return null;
      let x = 0, y = 0;
      for (let k = 0; k < 4; k++) if ((c >> k) & 1) { const a = this.angles[k] * Math.PI / 180; x += Math.cos(a); y += Math.sin(a); }
      if (Math.hypot(x, y) < 0.01) return null;
      return Math.atan2(y, x) * 180 / Math.PI;
    }
    advanceTo(t) {
      const dt = t - this.t;
      if (dt <= 0) return;
      const fa = this.fieldAngle;
      if (fa !== null) {
        const d = ((fa - this.theta) % 360 + 540) % 360 - 180;
        if (Math.abs(d) < 179.5) {
          const mv = Math.min(Math.abs(d), this.vmax * dt);
          this.theta += Math.sign(d) * mv;
        }
      }
      this.t = t;
    }
    setCoils(t, c) {
      this.advanceTo(t);
      if (c === this.coils) return;
      const wasOn = this.fieldAngle !== null;
      this.coils = c;
      this.fieldAngle = this.field(c);
      if (!this.started && this.fieldAngle !== null) {
        // erstes Einschalten: Rotor rastet sofort ein, diese Stellung ist "0"
        this.started = true; this.theta = this.fieldAngle; this.zero = this.fieldAngle;
      }
      if (this.fieldAngle !== null && wasOn) {
        const d = ((this.fieldAngle - this.theta) % 360 + 540) % 360 - 180;
        if (Math.abs(d) > 100) { this.lagT = t; this.missed++; }
      }
      if (this.fieldAngle !== null && this.lastField !== null && this.fieldAngle !== this.lastField) this.steps++;
      if (this.fieldAngle !== null) this.lastField = this.fieldAngle;
      this.hist.push([t, c]);
      if (this.hist.length > 6000) this.hist.splice(0, 1000);
    }
    get fullSteps() { return this.theta / 90; }
    get mech() { return this.theta / 90 * 360 / this.cfg.steps; }
    sample(t) {
      this.samples.push([t, this.theta]);
      while (this.samples.length > 2 && t - this.samples[0][0] > 0.6) this.samples.shift();
    }
    rpm() {
      const s = this.samples;
      if (s.length < 2) return 0;
      const a = s[0], b = s[s.length - 1];
      const dt = b[0] - a[0];
      if (dt < 0.05) return 0;
      return (b[1] - a[1]) / 90 / this.cfg.steps / dt * 60;
    }
  }

  // =====================================================================
  // Board
  // =====================================================================
  class Board {
    constructor(opts) {
      this.opts = opts;
      this.cfg = Object.assign({}, DEFAULT_CFG);
      this.stepper = new Stepper();
      this.clock = 1e6;
      this.mcu = null;
      this.btn = [false, false];
      this.pot = 512;
      this.buildChip(opts.chip);
      this.buildMotor(opts.motor);
      this.buildControls(opts.controls);
      this.la = opts.logic;
      this.laWindow = 0.1;
    }

    setConfig(cfg) {
      this.cfg = Object.assign({}, DEFAULT_CFG, cfg);
      this.stepper.configure(this.cfg);
      this.mp = this.cfg.mpins.map(parsePin);
      this.s1 = parsePin(this.cfg.s1); this.s2 = parsePin(this.cfg.s2);
      this.updateTags();
      this.buildLeds();
      if (this.mcu) this.applyInputs();
      this.renderMotorLabels();
    }

    attach(mcu) {
      this.mcu = mcu;
      mcu.onPins = p => this.onPins(p);
      mcu.analogIn = ch => (ch === this.cfg.potCh ? this.pot : 0);
      this.applyInputs();
    }

    simTime() { return this.mcu ? this.mcu.cycles / this.clock : 0; }

    applyInputs() {
      const m = this.mcu;
      m.extMask = [0, 0, 0]; m.extVal = [0, 0, 0];
      const btn = (pin, pressed) => {
        if (!pin) return;
        if (pressed) { m.extMask[pin.p] |= 1 << pin.b; m.extVal[pin.p] &= ~(1 << pin.b); }
        else if (this.cfg.extPullup) { m.extMask[pin.p] |= 1 << pin.b; m.extVal[pin.p] |= 1 << pin.b; }
      };
      btn(this.s1, this.btn[0]);
      btn(this.s2, this.btn[1]);
      const potBusy = [this.s1, this.s2].some(q => q && q.p === 1 && q.b === this.cfg.potCh);
      if (this.cfg.potCh >= 0 && !potBusy) {
        const b = this.cfg.potCh;
        m.extMask[1] |= 1 << b;
        if (this.pot > 511) m.extVal[1] |= 1 << b;
      }
      for (let p = 0; p < 3; p++) m.pinsChanged(p);
    }

    onPins(p) {
      const mp = this.mp;
      if (!mp) return;
      let c = 0;
      for (let k = 0; k < 4; k++) { const q = mp[k]; if (q && this.mcu.outHigh(q.p, q.b)) c |= 1 << k; }
      this.stepper.setCoils(this.mcu.cycles / this.clock, c);
    }

    resetSim() {
      this.stepper.reset();
      this.stepper.configure(this.cfg);
      this.ledVal = -1;
    }

    // ---------------- Chip ----------------
    buildChip(svg) {
      svg.innerHTML = '';
      svg.setAttribute('viewBox', '0 0 360 352');
      const bodyX = 128, bodyW = 104, top = 14, pitch = 23;
      el('rect', { x: bodyX, y: top - 4, width: bodyW, height: 14 * pitch + 6, rx: 6, class: 'chip-body' }, svg);
      el('path', { d: `M${bodyX + bodyW / 2 - 12} ${top - 4} a12 12 0 0 0 24 0`, class: 'chip-notch' }, svg);
      el('circle', { cx: bodyX + 14, cy: top + 10, r: 4, class: 'chip-dot' }, svg);
      const mx = bodyX + bodyW / 2, my = top + 7 * pitch - 6;
      const t1 = el('text', { x: mx - 6, y: my, class: 'chip-name', 'text-anchor': 'middle', transform: `rotate(-90 ${mx - 6} ${my})` }, svg); t1.textContent = 'ATMEGA8';
      const t2 = el('text', { x: mx + 14, y: my, class: 'chip-sub', 'text-anchor': 'middle', transform: `rotate(-90 ${mx + 14} ${my})` }, svg); t2.textContent = '16PU · DIP-28';
      this.pinEls = [];
      for (const [num, name, port, bit, alt] of AVR.PINOUT) {
        const left = num <= 14;
        const row = left ? num - 1 : 28 - num;
        const y = top + row * pitch + 6;
        const g = el('g', { class: 'pin' }, svg);
        const px = left ? bodyX - 14 : bodyX + bodyW;
        const r = el('rect', { x: px, y: y - 5, width: 14, height: 10, rx: 2, class: 'pin-leg' }, g);
        const nt = el('text', { x: left ? bodyX + 6 : bodyX + bodyW - 6, y: y + 3.5, class: 'pin-num', 'text-anchor': left ? 'start' : 'end' }, g);
        nt.textContent = num;
        const lab = el('text', { x: left ? px - 5 : px + 19, y: y + 4, class: 'pin-label' + (port < 0 ? ' pwr' : ''), 'text-anchor': left ? 'end' : 'start' }, g);
        lab.textContent = name;
        const altT = el('tspan', { class: 'pin-alt', dx: 3 }, null);
        altT.textContent = alt;
        if (left) { lab.textContent = ''; const a2 = el('tspan', { class: 'pin-alt' }, lab); a2.textContent = alt + ' '; const n2 = el('tspan', {}, lab); n2.textContent = name; }
        else lab.appendChild(altT);
        const tag = el('text', { x: left ? 6 : 354, y: y + 4, class: 'pin-tag', 'text-anchor': left ? 'start' : 'end' }, g);
        const title = el('title', {}, g);
        this.pinEls.push({ num, name, port, bit, alt, leg: r, tag, title, g, state: '' });
        if (name === 'VCC' || name === 'AVCC') r.classList.add('vcc');
        if (name === 'GND') r.classList.add('gnd');
      }
    }

    updateTags() {
      const tags = {};
      const mn = this.cfg.driver === 'l293' ? ['A1', 'A2', 'B1', 'B2'] : ['IN1', 'IN2', 'IN3', 'IN4'];
      this.cfg.mpins.forEach((n, k) => { tags[n] = (tags[n] ? tags[n] + ',' : '') + mn[k]; });
      if (this.cfg.s1) tags[this.cfg.s1] = (tags[this.cfg.s1] ? tags[this.cfg.s1] + ',' : '') + 'S1';
      if (this.cfg.s2) tags[this.cfg.s2] = (tags[this.cfg.s2] ? tags[this.cfg.s2] + ',' : '') + 'S2';
      if (this.cfg.potCh >= 0) { const n = 'PC' + this.cfg.potCh; tags[n] = (tags[n] ? tags[n] + ',' : '') + 'Poti'; }
      if (this.cfg.ledPort) for (let b = 0; b < 8; b++) { const n = 'P' + this.cfg.ledPort + b; if (this.cfg.ledPort === 'C' && b > 6) continue; tags[n] = (tags[n] ? tags[n] + ',' : '') + 'LED' + b; }
      for (const pe of this.pinEls) {
        const t = tags[pe.name] || '';
        pe.tag.textContent = t.length > 9 ? t.slice(0, 8) + '…' : t;
        pe.tagFull = t;
        pe.tag.setAttribute('class', 'pin-tag' + (/IN\d|[AB][12]/.test(t) ? ' t-motor' : /S\d/.test(t) ? ' t-btn' : /Poti/.test(t) ? ' t-pot' : t ? ' t-led' : ''));
      }
    }

    renderChip() {
      const m = this.mcu;
      for (const pe of this.pinEls) {
        if (pe.port < 0) {
          if (!pe.state) { pe.state = 'pwr'; pe.title.textContent = 'Pin ' + pe.num + ': ' + pe.name + ' (' + pe.alt + ')'; }
          continue;
        }
        const st = m ? m.pinState(pe.port, pe.bit) : 'float';
        if (st === pe.state) continue;
        pe.state = st;
        pe.leg.setAttribute('class', 'pin-leg s-' + st);
        const desc = { out1: 'Ausgang, HIGH (5 V)', out0: 'Ausgang, LOW (0 V)', in1: 'Eingang, HIGH (von außen)', in0: 'Eingang, LOW (von außen)', pullup: 'Eingang mit Pull-up, HIGH', float: 'Eingang, offen (nicht angeschlossen)' }[st];
        pe.title.textContent = 'Pin ' + pe.num + ': ' + pe.name + ' (' + pe.alt + ') – ' + desc + (pe.tagFull ? ' · verbunden mit ' + pe.tagFull : '');
      }
    }

    // ---------------- Motor ----------------
    buildMotor(root) {
      const svg = root.querySelector('.motor-svg');
      svg.innerHTML = '';
      svg.setAttribute('viewBox', '0 0 220 220');
      const cx = 110, cy = 110;
      el('circle', { cx, cy, r: 104, class: 'm-ring' }, svg);
      for (let a = 0; a < 360; a += 10) {
        const long = a % 90 === 0, mid = a % 30 === 0;
        const r1 = long ? 86 : mid ? 91 : 95, rad = (a - 90) * Math.PI / 180;
        el('line', { x1: cx + Math.cos(rad) * r1, y1: cy + Math.sin(rad) * r1, x2: cx + Math.cos(rad) * 100, y2: cy + Math.sin(rad) * 100, class: long ? 'm-tick long' : 'm-tick' }, svg);
        if (long) { const t = el('text', { x: cx + Math.cos(rad) * 75, y: cy + Math.sin(rad) * 75 + 4, class: 'm-deg', 'text-anchor': 'middle' }, svg); t.textContent = a + '°'; }
      }
      el('circle', { cx, cy, r: 62, class: 'm-housing' }, svg);
      for (let k = 0; k < 2; k++) {
        const x = k ? cx + 70 : cx - 70;
        el('circle', { cx: x, cy: cy - 52, r: 5, class: 'm-ear' }, svg);
      }
      el('circle', { cx, cy, r: 44, class: 'm-housing2' }, svg);
      this.rotor = el('g', {}, svg);
      el('path', { d: `M${cx - 6} ${cy - 64} L${cx + 6} ${cy - 64} L${cx + 9} ${cy - 20} L${cx - 9} ${cy - 20} Z`, class: 'm-arm' }, this.rotor);
      el('circle', { cx, cy, r: 20, class: 'm-hub' }, this.rotor);
      el('path', { d: `M${cx - 9} ${cy - 5} h18 v10 h-18 z`, class: 'm-shaft' }, this.rotor);
      el('circle', { cx, cy: cy - 56, r: 4, class: 'm-mark' }, this.rotor);
      this.motorSvg = svg;
      // Elektrische Ansicht
      const es = root.querySelector('.field-svg');
      es.innerHTML = '';
      es.setAttribute('viewBox', '0 0 120 120');
      el('circle', { cx: 60, cy: 60, r: 40, class: 'f-stator' }, es);
      this.coilEls = [];
      for (let k = 0; k < 4; k++) {
        const g = el('g', {}, es);
        const r = el('rect', { x: 50, y: 6, width: 20, height: 22, rx: 4, class: 'f-coil' }, g);
        const t = el('text', { x: 60, y: 22, class: 'f-coil-t', 'text-anchor': 'middle' }, g);
        t.textContent = k + 1;
        this.coilEls.push({ g, r, t });
      }
      this.magnet = el('g', {}, es);
      el('path', { d: 'M60 32 L68 60 L52 60 Z', class: 'f-n' }, this.magnet);
      el('path', { d: 'M52 60 L68 60 L60 88 Z', class: 'f-s' }, this.magnet);
      el('circle', { cx: 60, cy: 60, r: 4, class: 'f-hub' }, this.magnet);
      this.fieldSvg = es;
      this.drvLeds = Array.from(root.querySelectorAll('.drv-led'));
      this.mInfo = {
        angle: root.querySelector('[data-m=angle]'), steps: root.querySelector('[data-m=steps]'),
        rpm: root.querySelector('[data-m=rpm]'), turns: root.querySelector('[data-m=turns]'),
        status: root.querySelector('[data-m=status]'), title: root.querySelector('[data-m=title]'),
      };
      root.querySelector('[data-act=zero]').addEventListener('click', () => {
        const s = this.stepper; s.samples = []; s.missed = 0; s.steps = 0;
        s.zero = s.theta;
        this.render(true);
      });
    }

    renderMotorLabels() {
      const ang = this.stepper.angles || [0, 90, 180, 270];
      const names = this.cfg.driver === 'l293' ? ['A1', 'A2', 'B1', 'B2'] : ['1', '2', '3', '4'];
      this.coilEls.forEach((c, k) => {
        c.g.setAttribute('transform', `rotate(${ang[k]} 60 60)`);
        c.t.textContent = names[k];
        c.t.setAttribute('transform', `rotate(${-ang[k]} 60 17)`);
      });
      const pinsTxt = this.cfg.mpins;
      this.drvLeds.forEach((d, k) => {
        d.querySelector('b').textContent = this.cfg.driver === 'l293' ? names[k] : 'IN' + (k + 1);
        d.querySelector('small').textContent = pinsTxt[k];
      });
      const m = MOTORS[this.cfg.motor];
      this.mInfo.title.textContent = (m ? m.label : 'Eigener Motor') + ' · ' + this.cfg.steps + ' Schritte/U · ' + (this.cfg.driver === 'l293' ? 'L293D (bipolar)' : 'ULN2003 (unipolar)');
    }

    render(force) {
      const s = this.stepper;
      const t = this.simTime();
      s.advanceTo(t);
      s.sample(t);
      this.renderChip();
      // Motor
      const mech = (s.theta - s.zero) / 90 * 360 / this.cfg.steps;
      const md = ((mech % 360) + 360) % 360;
      this.rotor.setAttribute('transform', `rotate(${md.toFixed(2)} 110 110)`);
      this.magnet.setAttribute('transform', `rotate(${(s.theta % 360).toFixed(1)} 60 60)`);
      for (let k = 0; k < 4; k++) {
        const on = (s.coils >> k) & 1;
        if (this.coilEls[k].on !== on) { this.coilEls[k].on = on; this.coilEls[k].r.classList.toggle('on', !!on); this.drvLeds[k].classList.toggle('on', !!on); }
      }
      const fs = Math.round((s.theta - s.zero) / 45) / 2;
      const half = fs !== Math.round(fs);
      this.mInfo.angle.textContent = md.toFixed(1).replace('.', ',') + '°';
      this.mInfo.steps.textContent = (half ? fs.toFixed(1) : Math.round(fs)).toString().replace('.', ',');
      const rpm = s.rpm();
      this.mInfo.rpm.textContent = (Math.abs(rpm) < 0.05 ? '0' : rpm.toFixed(1).replace('.', ',')) + (rpm > 0.05 ? ' ↻' : rpm < -0.05 ? ' ↺' : '');
      this.mInfo.turns.textContent = (mech / 360).toFixed(2).replace('.', ',');
      let st, cls;
      if (t - s.lagT < 0.6) { st = '⚠ Schrittverlust – zu schnell!'; cls = 'warn'; }
      else if (s.coils === 0) { st = 'Spulen aus (Motor frei)'; cls = 'off'; }
      else if (Math.abs(rpm) > 0.05) { st = 'dreht ' + (rpm > 0 ? 'rechts herum' : 'links herum'); cls = 'run'; }
      else if (s.fieldAngle === null) { st = 'Spulen heben sich auf'; cls = 'warn'; }
      else { st = 'steht (hält Position)'; cls = 'hold'; }
      if (this.mInfo.status.textContent !== st) { this.mInfo.status.textContent = st; this.mInfo.status.className = 'm-status ' + cls; }
      this.renderLeds();
      this.renderLogic();
    }

    // ---------------- Bedienelemente ----------------
    buildControls(root) {
      this.ctrlRoot = root;
      const bind = (btnEl, i) => {
        const set = v => {
          if (this.btn[i] === v) return;
          this.btn[i] = v; btnEl.classList.toggle('pressed', v);
          if (this.mcu) this.applyInputs();
        };
        btnEl.addEventListener('pointerdown', e => {
          e.preventDefault();
          if (e.shiftKey || btnEl.classList.contains('latched')) { btnEl.classList.toggle('latched', !this.btn[i]); set(!this.btn[i]); return; }
          btnEl.setPointerCapture(e.pointerId); set(true);
        });
        const up = () => { if (!btnEl.classList.contains('latched')) set(false); };
        btnEl.addEventListener('pointerup', up);
        btnEl.addEventListener('pointercancel', up);
        btnEl.addEventListener('contextmenu', e => e.preventDefault());
        this['press' + (i + 1)] = set;
      };
      this.btnEls = [root.querySelector('[data-btn="0"]'), root.querySelector('[data-btn="1"]')];
      bind(this.btnEls[0], 0); bind(this.btnEls[1], 1);
      const pot = root.querySelector('.pot-range');
      const potV = root.querySelector('[data-pot]');
      const knob = root.querySelector('.pot-knob');
      const upd = () => {
        this.pot = +pot.value;
        potV.textContent = (this.pot * 5 / 1023).toFixed(2).replace('.', ',') + ' V · ' + this.pot;
        if (knob) knob.style.transform = `rotate(${-135 + this.pot / 1023 * 270}deg)`;
        if (this.mcu) this.applyInputs();
      };
      pot.addEventListener('input', upd);
      upd();
      this.ledRow = root.querySelector('.led-row');
      this.btnLabels = [root.querySelector('[data-btnlabel="0"]'), root.querySelector('[data-btnlabel="1"]')];
      this.potLabel = root.querySelector('[data-potlabel]');
      this.ledLabel = root.querySelector('[data-ledlabel]');
    }

    buildLeds() {
      this.ledRow.innerHTML = '';
      this.leds = [];
      const port = this.cfg.ledPort;
      this.ledLabel.textContent = port ? 'LEDs an PORT' + port + ' (Bit 7 … 0)' : 'LED-Zeile ausgeschaltet';
      if (port) {
        for (let b = 7; b >= 0; b--) {
          const d = document.createElement('div');
          d.className = 'led';
          if (port === 'C' && b === 7) d.classList.add('na');
          d.innerHTML = '<i></i><small>' + b + '</small>';
          d.title = 'P' + port + b;
          this.ledRow.appendChild(d);
          this.leds[b] = d;
        }
      }
      this.btnLabels[0].textContent = 'S1 · ' + (this.cfg.s1 || '–');
      this.btnLabels[1].textContent = 'S2 · ' + (this.cfg.s2 || '–');
      this.potLabel.textContent = this.cfg.potCh >= 0 ? 'Poti · PC' + this.cfg.potCh + ' (ADC' + this.cfg.potCh + ')' : 'Poti · nicht angeschlossen';
    }

    renderLeds() {
      const port = this.cfg.ledPort;
      if (!port || !this.mcu) return;
      const p = PORT_IDX[port];
      const v = this.mcu.ddr[p] & this.mcu.port[p];
      if (v === this.ledVal) return;
      this.ledVal = v;
      for (let b = 0; b < 8; b++) if (this.leds[b]) this.leds[b].classList.toggle('on', !!((v >> b) & 1));
    }

    // ---------------- Logikanalysator ----------------
    renderLogic() {
      const cv = this.la;
      if (!cv || !cv.offsetParent) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = n => css.getPropertyValue(n).trim();
      ctx.fillStyle = col('--la-bg'); ctx.fillRect(0, 0, W, H);
      const now = this.simTime(), win = this.laWindow, t0 = now - win;
      const left = 78, right = W - 10, rows = 4, rh = (H - 26) / rows;
      const x = t => left + (t - t0) / win * (right - left);
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      // Gitter
      ctx.strokeStyle = col('--la-grid'); ctx.lineWidth = 1;
      ctx.fillStyle = col('--muted');
      for (let k = 0; k <= 10; k++) {
        const gx = left + k * (right - left) / 10;
        ctx.beginPath(); ctx.moveTo(gx, 4); ctx.lineTo(gx, H - 20); ctx.stroke();
      }
      const fmt = s => (s >= 1 ? s.toFixed(1).replace('.', ',') + ' s' : Math.round(s * 1000) + ' ms');
      ctx.textAlign = 'left'; ctx.fillText('−' + fmt(win), left, H - 6);
      ctx.textAlign = 'right'; ctx.fillText('jetzt', right, H - 6);
      ctx.textAlign = 'center'; ctx.fillText(fmt(win / 10) + ' / Kästchen', (left + right) / 2, H - 6);
      const hist = this.stepper.hist;
      let i0 = hist.length - 1;
      while (i0 > 0 && hist[i0][0] > t0) i0--;
      const colors = [col('--la-1'), col('--la-2'), col('--la-3'), col('--la-4')];
      for (let k = 0; k < rows; k++) {
        const yHi = 8 + k * rh, yLo = yHi + rh - 12;
        ctx.fillStyle = colors[k]; ctx.textAlign = 'left';
        ctx.fillText((this.cfg.driver === 'l293' ? ['A1', 'A2', 'B1', 'B2'][k] : 'IN' + (k + 1)) + ' ' + this.cfg.mpins[k], 6, (yHi + yLo) / 2 + 4);
        ctx.strokeStyle = colors[k]; ctx.lineWidth = 2;
        ctx.beginPath();
        let prev = null;
        for (let i = i0; i < hist.length; i++) {
          const [t, c] = hist[i];
          const v = (c >> k) & 1;
          const xx = Math.max(left, x(t));
          const y = v ? yHi : yLo;
          if (prev === null) ctx.moveTo(xx, y); else { ctx.lineTo(xx, prev); ctx.lineTo(xx, y); }
          prev = y;
        }
        if (prev !== null) ctx.lineTo(right, prev);
        ctx.stroke();
      }
    }
  }

  Board.MOTORS = MOTORS;
  Board.DEFAULT_CFG = DEFAULT_CFG;
  Board.parsePin = parsePin;
  G.AvrBoard = Board;
})(window);
