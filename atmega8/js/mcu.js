/* ATmega8 – Simulation der Peripherie (Ports, Timer, Interrupts, ADC, UART)
 * Die CPU selbst wird nicht Befehl für Befehl simuliert: der C-Code wird
 * interpretiert (vm.js) und meldet die verbrauchten Takte an diese Klasse.
 */
(function (G) {
  'use strict';

  // ---------- Register (Name -> Bitbreite) ----------
  const REGS = {
    PORTB: 8, DDRB: 8, PINB: 8, PORTC: 8, DDRC: 8, PINC: 8, PORTD: 8, DDRD: 8, PIND: 8,
    SREG: 8, SPL: 8, SPH: 8, SP: 16,
    TCCR0: 8, TCNT0: 8, TIMSK: 8, TIFR: 8,
    TCCR1A: 8, TCCR1B: 8, TCNT1: 16, TCNT1H: 8, TCNT1L: 8,
    OCR1A: 16, OCR1AH: 8, OCR1AL: 8, OCR1B: 16, OCR1BH: 8, OCR1BL: 8, ICR1: 16, ICR1H: 8, ICR1L: 8,
    TCCR2: 8, TCNT2: 8, OCR2: 8, ASSR: 8,
    GICR: 8, GIFR: 8, MCUCR: 8, MCUCSR: 8, SFIOR: 8, OSCCAL: 8, WDTCR: 8,
    ADMUX: 8, ADCSRA: 8, ADCSR: 8, ADC: 16, ADCW: 16, ADCL: 8, ADCH: 8, ACSR: 8,
    UDR: 8, UCSRA: 8, UCSRB: 8, UCSRC: 8, UBRRL: 8, UBRRH: 8,
    SPCR: 8, SPSR: 8, SPDR: 8, TWBR: 8, TWCR: 8, TWSR: 8, TWAR: 8, TWDR: 8,
    EEARL: 8, EEARH: 8, EEDR: 8, EECR: 8,
  };

  // ---------- Bitnamen aus <avr/io.h> (iom8.h) ----------
  const BITS = {};
  for (let i = 0; i < 8; i++) {
    BITS['PB' + i] = i; BITS['PORTB' + i] = i; BITS['DDB' + i] = i; BITS['PINB' + i] = i;
    BITS['PD' + i] = i; BITS['PORTD' + i] = i; BITS['DDD' + i] = i; BITS['PIND' + i] = i;
    if (i < 7) { BITS['PC' + i] = i; BITS['PORTC' + i] = i; BITS['DDC' + i] = i; BITS['PINC' + i] = i; }
  }
  Object.assign(BITS, {
    OCIE2: 7, TOIE2: 6, TICIE1: 5, OCIE1A: 4, OCIE1B: 3, TOIE1: 2, TOIE0: 0,
    OCF2: 7, TOV2: 6, ICF1: 5, OCF1A: 4, OCF1B: 3, TOV1: 2, TOV0: 0,
    CS02: 2, CS01: 1, CS00: 0,
    COM1A1: 7, COM1A0: 6, COM1B1: 5, COM1B0: 4, FOC1A: 3, FOC1B: 2, WGM11: 1, WGM10: 0,
    ICNC1: 7, ICES1: 6, WGM13: 4, WGM12: 3, CS12: 2, CS11: 1, CS10: 0,
    FOC2: 7, WGM20: 6, COM21: 5, COM20: 4, WGM21: 3, CS22: 2, CS21: 1, CS20: 0,
    INT1: 7, INT0: 6, IVSEL: 1, IVCE: 0, INTF1: 7, INTF0: 6,
    SE: 7, SM2: 6, SM1: 5, SM0: 4, ISC11: 3, ISC10: 2, ISC01: 1, ISC00: 0,
    REFS1: 7, REFS0: 6, ADLAR: 5, MUX3: 3, MUX2: 2, MUX1: 1, MUX0: 0,
    ADEN: 7, ADSC: 6, ADFR: 5, ADIF: 4, ADIE: 3, ADPS2: 2, ADPS1: 1, ADPS0: 0,
    RXC: 7, TXC: 6, UDRE: 5, FE: 4, DOR: 3, PE: 2, U2X: 1, MPCM: 0,
    RXCIE: 7, TXCIE: 6, UDRIE: 5, RXEN: 4, TXEN: 3, UCSZ2: 2, RXB8: 1, TXB8: 0,
    URSEL: 7, UMSEL: 6, UPM1: 5, UPM0: 4, USBS: 3, UCSZ1: 2, UCSZ0: 1, UCPOL: 0,
    SREG_I: 7, SREG_T: 6, SREG_H: 5, SREG_S: 4, SREG_V: 3, SREG_N: 2, SREG_Z: 1, SREG_C: 0,
    RAMEND: 0x45F, FLASHEND: 0x1FFF, E2END: 0x1FF,
  });

  // ---------- Interrupt-Vektoren (Priorität = Reihenfolge) ----------
  const VECTORS = ['INT0_vect', 'INT1_vect', 'TIMER2_COMP_vect', 'TIMER2_OVF_vect', 'TIMER1_CAPT_vect',
    'TIMER1_COMPA_vect', 'TIMER1_COMPB_vect', 'TIMER1_OVF_vect', 'TIMER0_OVF_vect', 'SPI_STC_vect',
    'USART_RXC_vect', 'USART_UDRE_vect', 'USART_TXC_vect', 'ADC_vect', 'EE_RDY_vect', 'ANA_COMP_vect',
    'TWI_vect', 'SPM_RDY_vect'];

  const PORTS = ['B', 'C', 'D'];
  const PMASK = [0xFF, 0x7F, 0xFF];
  const P01 = [0, 1, 8, 64, 256, 1024, 0, 0];
  const P2 = [0, 1, 8, 32, 64, 128, 256, 1024];
  const ADPS = [2, 2, 4, 8, 16, 32, 64, 128];

  // DIP-28 Pinbelegung: [Pin-Nr, Name, Port(0=B,1=C,2=D,-1), Bit, Zweitfunktion]
  const PINOUT = [
    [1, 'PC6', 1, 6, 'RESET'], [2, 'PD0', 2, 0, 'RXD'], [3, 'PD1', 2, 1, 'TXD'], [4, 'PD2', 2, 2, 'INT0'],
    [5, 'PD3', 2, 3, 'INT1'], [6, 'PD4', 2, 4, 'T0'], [7, 'VCC', -1, 0, '+5 V'], [8, 'GND', -1, 0, 'Masse'],
    [9, 'PB6', 0, 6, 'XTAL1'], [10, 'PB7', 0, 7, 'XTAL2'], [11, 'PD5', 2, 5, 'T1'], [12, 'PD6', 2, 6, 'AIN0'],
    [13, 'PD7', 2, 7, 'AIN1'], [14, 'PB0', 0, 0, 'ICP1'], [15, 'PB1', 0, 1, 'OC1A'], [16, 'PB2', 0, 2, 'OC1B'],
    [17, 'PB3', 0, 3, 'OC2/MOSI'], [18, 'PB4', 0, 4, 'MISO'], [19, 'PB5', 0, 5, 'SCK'], [20, 'AVCC', -1, 0, '+5 V'],
    [21, 'AREF', -1, 0, 'Referenz'], [22, 'GND', -1, 0, 'Masse'], [23, 'PC0', 1, 0, 'ADC0'], [24, 'PC1', 1, 1, 'ADC1'],
    [25, 'PC2', 1, 2, 'ADC2'], [26, 'PC3', 1, 3, 'ADC3'], [27, 'PC4', 1, 4, 'ADC4/SDA'], [28, 'PC5', 1, 5, 'ADC5/SCL'],
  ];

  // Zähler um "ticks" Schritte weiterzählen. top = Endwert (danach 0), max = 0xFF / 0xFFFF.
  function countTimer(cnt, ticks, top, max, cmps, hits) {
    let maxHit = false, topHit = false;
    for (let k = 0; k < cmps.length; k++) hits[k] = false;
    if (cnt > top) {
      const toWrap = max - cnt + 1;
      if (ticks < toWrap) {
        for (let k = 0; k < cmps.length; k++) if (cmps[k] > cnt && cmps[k] <= cnt + ticks) hits[k] = true;
        return { cnt: cnt + ticks, maxHit, topHit };
      }
      for (let k = 0; k < cmps.length; k++) if (cmps[k] > cnt) hits[k] = true;
      ticks -= toWrap; cnt = 0; maxHit = true;
      for (let k = 0; k < cmps.length; k++) if (cmps[k] === 0) hits[k] = true;
    }
    const period = top + 1;
    for (let k = 0; k < cmps.length; k++) {
      const c = cmps[k];
      if (c > top) continue;
      let d = c - cnt; if (d <= 0) d += period;
      if (d <= ticks) hits[k] = true;
    }
    if (ticks >= top - cnt + 1) { topHit = true; if (top === max) maxHit = true; }
    return { cnt: (cnt + ticks) % period, maxHit, topHit };
  }

  function ticksTo(cnt, top, max, c) {
    if (cnt > top) return max - cnt + 1;
    let d = c - cnt; if (d <= 0) d += top + 1; return d;
  }

  class ATmega8 {
    constructor() {
      this.onPins = null;     // (port) => void
      this.onSerial = null;   // (char) => void
      this.onWarn = null;     // (text) => void
      this.analogIn = () => 0; // (kanal) => 0..1023 bei 5 V
      this.extMask = [0, 0, 0];
      this.extVal = [0, 0, 0];
      this.rx = [];
      this.reset();
    }

    reset() {
      this.cycles = 0;
      this.ddr = [0, 0, 0];
      this.port = [0, 0, 0];
      this.lastLevel = [0, 0, 0];
      this.r = Object.create(null);
      this.sreg = 0;
      this.t0 = { cnt: 0, acc: 0 };
      this.t1 = { cnt: 0, acc: 0 };
      this.t2 = { cnt: 0, acc: 0 };
      this.ocr1a = 0; this.ocr1b = 0; this.icr1 = 0; this.ocr2 = 0;
      this.tifr = 0; this.timsk = 0; this.gifr = 0; this.gicr = 0; this.mcucr = 0;
      this.tccr0 = 0; this.tccr1a = 0; this.tccr1b = 0; this.tccr2 = 0;
      this.admux = 0; this.adcsra = 0; this.adc = 0; this.adcBusy = false; this.adcDone = 0;
      this.ucsrb = 0; this.txc = false;
      this.rx = [];
      this.warned = new Set();
      this.hits = [false, false];
      this.busy = false;
      for (let p = 0; p < 3; p++) this.lastLevel[p] = this.level(p);
      this.irq = false;
    }

    warnOnce(key, text) {
      if (this.warned.has(key)) return;
      this.warned.add(key);
      if (this.onWarn) this.onWarn(text);
    }

    // ---------- Pins ----------
    level(p) {
      const d = this.ddr[p], o = this.port[p], m = this.extMask[p], v = this.extVal[p];
      return ((d & o) | (~d & m & v) | (~d & ~m & o)) & PMASK[p];
    }
    // Pin ist Ausgang und HIGH?
    outHigh(p, b) { return ((this.ddr[p] & this.port[p]) >> b) & 1; }
    pinState(p, b) {
      const bit = 1 << b;
      if (this.ddr[p] & bit) return (this.port[p] & bit) ? 'out1' : 'out0';
      if (this.extMask[p] & bit) return (this.extVal[p] & bit) ? 'in1' : 'in0';
      if (this.port[p] & bit) return 'pullup';
      return 'float';
    }

    setExt(p, b, driven, val) {
      const bit = 1 << b;
      if (driven) this.extMask[p] |= bit; else this.extMask[p] &= ~bit;
      if (val) this.extVal[p] |= bit; else this.extVal[p] &= ~bit;
      this.pinsChanged(p);
    }

    pinsChanged(p) {
      const L = this.level(p), old = this.lastLevel[p];
      this.lastLevel[p] = L;
      if (p === 2 && L !== old) {
        this.edge(2, (old >> 2) & 1, (L >> 2) & 1, this.mcucr & 3, 0x40);
        this.edge(3, (old >> 3) & 1, (L >> 3) & 1, (this.mcucr >> 2) & 3, 0x80);
      }
      if (this.onPins) this.onPins(p);
      this.updateIrq();
    }
    edge(bit, o, n, isc, flag) {
      if (o === n) return;
      if (isc === 1 || (isc === 2 && o && !n) || (isc === 3 && !o && n)) this.gifr |= flag;
    }

    // ---------- Interrupts ----------
    pending() {
      const lvl = this.lastLevel[2];
      if ((this.gicr & 0x40) && ((this.gifr & 0x40) || ((this.mcucr & 3) === 0 && !(lvl & 4)))) return 0;
      if ((this.gicr & 0x80) && ((this.gifr & 0x80) || (((this.mcucr >> 2) & 3) === 0 && !(lvl & 8)))) return 1;
      const t = this.timsk & this.tifr;
      if (t) {
        if (t & 0x80) return 2;
        if (t & 0x40) return 3;
        if (t & 0x20) return 4;
        if (t & 0x10) return 5;
        if (t & 0x08) return 6;
        if (t & 0x04) return 7;
        if (t & 0x01) return 8;
      }
      if ((this.ucsrb & 0x80) && this.rx.length) return 10;
      if ((this.ucsrb & 0x20)) return 11;
      if ((this.ucsrb & 0x40) && this.txc) return 12;
      if ((this.adcsra & 0x08) && (this.adcsra & 0x10)) return 13;
      return -1;
    }
    updateIrq() { this.irq = (this.sreg & 0x80) !== 0 && this.pending() >= 0; }
    // Beim Sprung in den Vektor: Flag löschen (wie die Hardware)
    ack(v) {
      switch (v) {
        case 0: this.gifr &= ~0x40; break;
        case 1: this.gifr &= ~0x80; break;
        case 2: this.tifr &= ~0x80; break;
        case 3: this.tifr &= ~0x40; break;
        case 4: this.tifr &= ~0x20; break;
        case 5: this.tifr &= ~0x10; break;
        case 6: this.tifr &= ~0x08; break;
        case 7: this.tifr &= ~0x04; break;
        case 8: this.tifr &= ~0x01; break;
        case 12: this.txc = false; break;
        case 13: this.adcsra &= ~0x10; break;
      }
      this.updateIrq();
    }

    // ---------- Zeit ----------
    updateBusy() {
      this.busy = (this.tccr0 & 7) !== 0 || (this.tccr1b & 7) !== 0 || (this.tccr2 & 7) !== 0 || this.adcBusy;
      if ((this.tccr0 & 7) >= 6) this.warnOnce('t0ext', 'Timer0: externer Takt an T0 wird nicht simuliert.');
      if ((this.tccr1b & 7) >= 6) this.warnOnce('t1ext', 'Timer1: externer Takt an T1 wird nicht simuliert.');
    }
    t1wgm() { return (this.tccr1a & 3) | ((this.tccr1b >> 1) & 0x0C); }
    t1top() {
      switch (this.t1wgm()) {
        case 1: case 5: return 0xFF;
        case 2: case 6: return 0x1FF;
        case 3: case 7: return 0x3FF;
        case 4: case 9: case 11: case 15: return this.ocr1a;
        case 8: case 10: case 12: case 14: return this.icr1;
        default: return 0xFFFF;
      }
    }
    t2top() { return ((this.tccr2 & 0x48) === 0x08) ? this.ocr2 : 0xFF; }

    advance(delta) {
      this.cycles += delta;
      if (!this.busy) return;
      let changed = false;
      // Timer0 (nur Überlauf)
      let p = P01[this.tccr0 & 7];
      if (p) {
        const t = this.t0; t.acc += delta;
        if (t.acc >= p) {
          const ticks = Math.floor(t.acc / p); t.acc -= ticks * p;
          const n = t.cnt + ticks;
          if (n > 255) { this.tifr |= 0x01; changed = true; }
          t.cnt = n & 255;
        }
      }
      // Timer1
      p = P01[this.tccr1b & 7];
      if (p) {
        const t = this.t1; t.acc += delta;
        if (t.acc >= p) {
          const ticks = Math.floor(t.acc / p); t.acc -= ticks * p;
          const wgm = this.t1wgm(), top = this.t1top();
          const r = countTimer(t.cnt, ticks, top, 0xFFFF, [this.ocr1a, this.ocr1b], this.hits);
          t.cnt = r.cnt;
          if (this.hits[0]) this.tifr |= 0x10;
          if (this.hits[1]) this.tifr |= 0x08;
          const ovf = (wgm === 0 || wgm === 4 || wgm === 12) ? r.maxHit : r.topHit;
          if (ovf) this.tifr |= 0x04;
          if ((wgm === 12) && r.topHit) this.tifr |= 0x20;
          changed = true;
        }
      }
      // Timer2
      p = P2[this.tccr2 & 7];
      if (p) {
        const t = this.t2; t.acc += delta;
        if (t.acc >= p) {
          const ticks = Math.floor(t.acc / p); t.acc -= ticks * p;
          const ctc = (this.tccr2 & 0x48) === 0x08;
          const r = countTimer(t.cnt, ticks, this.t2top(), 0xFF, [this.ocr2], this.hits);
          t.cnt = r.cnt;
          if (this.hits[0]) this.tifr |= 0x80;
          if (ctc ? r.maxHit : r.topHit) this.tifr |= 0x40;
          changed = true;
        }
      }
      // ADC
      if (this.adcBusy && this.cycles >= this.adcDone) {
        this.adcBusy = false;
        this.adc = this.convert();
        this.adcsra |= 0x10;
        if (this.adcsra & 0x20) this.startAdc(13); else this.adcsra &= ~0x40;
        this.updateBusy();
        changed = true;
      }
      if (changed) this.updateIrq();
    }

    // Takt (absolut) des nächsten Ereignisses, das einen Interrupt auslösen kann
    nextEvent() {
      let best = Infinity;
      const tm = this.timsk;
      let p = P01[this.tccr0 & 7];
      if (p && (tm & 0x01)) best = Math.min(best, (256 - this.t0.cnt) * p - this.t0.acc);
      p = P01[this.tccr1b & 7];
      if (p && (tm & 0x1C)) {
        const top = this.t1top(), c = this.t1.cnt;
        let tk = Infinity;
        if (tm & 0x10) tk = Math.min(tk, ticksTo(c, top, 0xFFFF, this.ocr1a));
        if (tm & 0x08) tk = Math.min(tk, ticksTo(c, top, 0xFFFF, this.ocr1b));
        if (tm & 0x04) tk = Math.min(tk, c > top ? 0xFFFF - c + 1 : top - c + 1);
        best = Math.min(best, tk * p - this.t1.acc);
      }
      p = P2[this.tccr2 & 7];
      if (p && (tm & 0xC0)) {
        const top = this.t2top(), c = this.t2.cnt;
        let tk = Infinity;
        if (tm & 0x80) tk = Math.min(tk, ticksTo(c, top, 0xFF, this.ocr2));
        if (tm & 0x40) tk = Math.min(tk, c > top ? 0xFF - c + 1 : top - c + 1);
        best = Math.min(best, tk * p - this.t2.acc);
      }
      if (this.adcBusy) best = Math.min(best, this.adcDone - this.cycles);
      return this.cycles + Math.max(1, best);
    }

    // ---------- ADC ----------
    startAdc(n) {
      this.adcBusy = true;
      this.adcDone = this.cycles + n * ADPS[this.adcsra & 7];
      this.updateBusy();
    }
    convert() {
      const mux = this.admux & 0x0F;
      const refs = this.admux >> 6;
      const vref = refs === 3 ? 2.56 : 5.0;
      let volt;
      if (mux === 14) volt = 1.30; else if (mux === 15) volt = 0;
      else if (mux > 5) { this.warnOnce('adc67', 'ADC6/ADC7 gibt es beim ATmega8 im DIP-Gehäuse nicht.'); volt = 0; }
      else volt = this.analogIn(mux) * 5 / 1023;
      if (refs === 2) this.warnOnce('refs', 'ADMUX: REFS1:0 = 10 ist beim ATmega8 reserviert.');
      let v = Math.round(volt / vref * 1024);
      if (v > 1023) v = 1023; if (v < 0) v = 0;
      return v;
    }
    adcValue() { return (this.admux & 0x20) ? (this.adc << 6) & 0xFFFF : this.adc; }

    // ---------- Registerzugriff ----------
    read(name) {
      switch (name) {
        case 'PINB': return this.level(0);
        case 'PINC': return this.level(1);
        case 'PIND': return this.level(2);
        case 'PORTB': return this.port[0];
        case 'PORTC': return this.port[1];
        case 'PORTD': return this.port[2];
        case 'DDRB': return this.ddr[0];
        case 'DDRC': return this.ddr[1];
        case 'DDRD': return this.ddr[2];
        case 'SREG': return this.sreg;
        case 'TCNT0': return this.t0.cnt;
        case 'TCNT1': return this.t1.cnt;
        case 'TCNT1L': return this.t1.cnt & 0xFF;
        case 'TCNT1H': return this.t1.cnt >> 8;
        case 'TCNT2': return this.t2.cnt;
        case 'TCCR0': return this.tccr0;
        case 'TCCR1A': return this.tccr1a;
        case 'TCCR1B': return this.tccr1b;
        case 'TCCR2': return this.tccr2;
        case 'OCR1A': return this.ocr1a;
        case 'OCR1AL': return this.ocr1a & 0xFF;
        case 'OCR1AH': return this.ocr1a >> 8;
        case 'OCR1B': return this.ocr1b;
        case 'OCR1BL': return this.ocr1b & 0xFF;
        case 'OCR1BH': return this.ocr1b >> 8;
        case 'ICR1': return this.icr1;
        case 'ICR1L': return this.icr1 & 0xFF;
        case 'ICR1H': return this.icr1 >> 8;
        case 'OCR2': return this.ocr2;
        case 'TIFR': return this.tifr;
        case 'TIMSK': return this.timsk;
        case 'GIFR': return this.gifr;
        case 'GICR': return this.gicr;
        case 'MCUCR': return this.mcucr;
        case 'ADMUX': return this.admux;
        case 'ADCSRA': case 'ADCSR': return this.adcsra;
        case 'ADC': case 'ADCW': return this.adcValue();
        case 'ADCL': return this.adcValue() & 0xFF;
        case 'ADCH': return this.adcValue() >> 8;
        case 'UDR': {
          const c = this.rx.length ? this.rx.shift() : 0;
          this.updateIrq();
          return c;
        }
        case 'UCSRA': return (this.rx.length ? 0x80 : 0) | 0x20 | (this.txc ? 0x40 : 0) | ((this.r.UCSRA || 0) & 0x03);
        case 'UCSRB': return this.ucsrb;
        case 'SPL': return 0x5F;
        case 'SPH': return 0x04;
        case 'SP': return 0x45F;
        default: return this.r[name] || 0;
      }
    }

    write(name, v) {
      switch (name) {
        case 'PORTB': this.port[0] = v & 0xFF; this.pinsChanged(0); return;
        case 'PORTC': this.port[1] = v & 0x7F; this.pinsChanged(1); return;
        case 'PORTD': this.port[2] = v & 0xFF; this.pinsChanged(2); return;
        case 'DDRB': this.ddr[0] = v & 0xFF; this.pinsChanged(0); return;
        case 'DDRC':
          if (v & 0x40) this.warnOnce('pc6', 'PC6 ist normalerweise der RESET-Pin und kann nicht als Ausgang benutzt werden.');
          this.ddr[1] = v & 0x7F; this.pinsChanged(1); return;
        case 'DDRD': this.ddr[2] = v & 0xFF; this.pinsChanged(2); return;
        case 'PINB': case 'PINC': case 'PIND':
          this.warnOnce('pinw', 'Hinweis: Beim ATmega8 kann man PINx nicht beschreiben (kein Umschalten wie bei neueren AVRs). Benutze PORTx ^= ...');
          return;
        case 'SREG': this.sreg = v & 0xFF; this.updateIrq(); return;
        case 'TCNT0': this.t0.cnt = v & 0xFF; return;
        case 'TCNT1': this.t1.cnt = v & 0xFFFF; return;
        case 'TCNT1L': this.t1.cnt = (this.t1.cnt & 0xFF00) | (v & 0xFF); return;
        case 'TCNT1H': this.t1.cnt = (this.t1.cnt & 0xFF) | ((v & 0xFF) << 8); return;
        case 'TCNT2': this.t2.cnt = v & 0xFF; return;
        case 'TCCR0': this.tccr0 = v & 7; this.updateBusy(); return;
        case 'TCCR1A': this.tccr1a = v & 0xFF; return;
        case 'TCCR1B': this.tccr1b = v & 0xDF; this.updateBusy(); return;
        case 'TCCR2': this.tccr2 = v & 0x7F; this.updateBusy(); return;
        case 'OCR1A': this.ocr1a = v & 0xFFFF; return;
        case 'OCR1AL': this.ocr1a = (this.ocr1a & 0xFF00) | (v & 0xFF); return;
        case 'OCR1AH': this.ocr1a = (this.ocr1a & 0xFF) | ((v & 0xFF) << 8); return;
        case 'OCR1B': this.ocr1b = v & 0xFFFF; return;
        case 'OCR1BL': this.ocr1b = (this.ocr1b & 0xFF00) | (v & 0xFF); return;
        case 'OCR1BH': this.ocr1b = (this.ocr1b & 0xFF) | ((v & 0xFF) << 8); return;
        case 'ICR1': this.icr1 = v & 0xFFFF; return;
        case 'ICR1L': this.icr1 = (this.icr1 & 0xFF00) | (v & 0xFF); return;
        case 'ICR1H': this.icr1 = (this.icr1 & 0xFF) | ((v & 0xFF) << 8); return;
        case 'OCR2': this.ocr2 = v & 0xFF; return;
        case 'TIFR': this.tifr &= ~v; this.updateIrq(); return;      // 1 schreiben löscht
        case 'TIMSK': this.timsk = v & 0xFF; this.updateIrq(); return;
        case 'GIFR': this.gifr &= ~(v & 0xC0); this.updateIrq(); return;
        case 'GICR': this.gicr = v & 0xC3; this.updateIrq(); return;
        case 'MCUCR': this.mcucr = v & 0xFF; this.updateIrq(); return;
        case 'ADMUX': this.admux = v & 0xEF; return;
        case 'ADCSRA': case 'ADCSR': {
          const clear = v & 0x10;
          this.adcsra = (v & ~0x10 & 0xFF) | (this.adcsra & 0x10);
          if (clear) this.adcsra &= ~0x10;
          if ((v & 0x40) && (v & 0x80) && !this.adcBusy) this.startAdc(this.r._adcFirst ? 13 : 25), this.r._adcFirst = 1;
          if ((v & 0x40) && !(v & 0x80)) this.warnOnce('aden', 'ADC: ADSC gesetzt, aber der ADC ist nicht eingeschaltet (ADEN fehlt).');
          if (!(v & 0x80)) { this.adcBusy = false; this.adcsra &= ~0x40; this.updateBusy(); }
          if (this.adcBusy) this.adcsra |= 0x40;
          this.updateIrq();
          return;
        }
        case 'UDR':
          if (!(this.ucsrb & 0x08)) {
            this.warnOnce('txen', 'UART: In UDR geschrieben, aber der Sender ist nicht eingeschaltet (UCSRB |= (1<<TXEN) fehlt).');
            return;
          }
          this.txc = true;
          if (this.onSerial) this.onSerial(v & 0xFF);
          this.updateIrq();
          return;
        case 'UCSRA': this.r.UCSRA = v & 0x03; if (v & 0x40) this.txc = false; this.updateIrq(); return;
        case 'UCSRB': this.ucsrb = v & 0xFF; this.updateIrq(); return;
        default: this.r[name] = v;
      }
    }

    serialInput(str) {
      for (const ch of str) this.rx.push(ch.charCodeAt(0) & 0xFF);
      if (this.rx.length > 64) this.rx.splice(0, this.rx.length - 64);
      this.updateIrq();
    }
  }

  ATmega8.REGS = REGS;
  ATmega8.BITS = BITS;
  ATmega8.VECTORS = VECTORS;
  ATmega8.PORTS = PORTS;
  ATmega8.PMASK = PMASK;
  ATmega8.PINOUT = PINOUT;
  ATmega8.prescalers = { P01, P2 };
  G.ATmega8 = ATmega8;
})(typeof window !== 'undefined' ? window : globalThis);
