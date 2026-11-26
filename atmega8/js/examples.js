/* Beispielprogramme – alle laufen auch auf einem echten ATmega8 mit avr-gcc */
(function (G) {
  'use strict';
  const EX = [];
  // C-Beispiele: Motor über ULN2003 an PB0..PB3, Taster an PD2/PD3, Poti an PC0
  const C_CFG = { driver: 'uln', s1: 'PD2', s2: 'PD3', potCh: 0 };
  const C_TXT = 'Motor über ULN2003 an PB0…PB3, Taster an PD2/PD3, Poti an PC0';
  const add = (id, title, code) => EX.push({ id, title, code: code.replace(/^\n/, ''), cfg: id === 'lauflicht' ? Object.assign({ ledPort: 'D' }, C_CFG) : C_CFG, cfgText: C_TXT });

  add('vorlage', 'Leere Vorlage', `
/*
 * Mein Programm
 * Schrittmotor (ULN2003): IN1..IN4 an PB0..PB3
 */
#define F_CPU 1000000UL     // Takt: 1 MHz (Werkseinstellung ATmega8)
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    DDRB = 0x0F;            // PB0..PB3 als Ausgang

    while (1)
    {
        // hier kommt dein Programm hin
    }

    return 0;
}
`);

  add('vollschritt', 'Schrittmotor: Vollschritt', `
/*
 * Schrittmotor im Vollschritt-Betrieb
 * Es sind immer zwei Spulen gleichzeitig eingeschaltet -> viel Kraft.
 *
 * Anschluss (ULN2003-Treiber):  IN1=PB0  IN2=PB1  IN3=PB2  IN4=PB3
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    //                       IN4..IN1
    uint8_t schritte[4] = { 0b0011,
                            0b0110,
                            0b1100,
                            0b1001 };
    uint8_t i = 0;

    DDRB |= 0x0F;                    // PB0..PB3 als Ausgang

    while (1)
    {
        // nur die unteren 4 Bit von PORTB verändern
        PORTB = (PORTB & 0xF0) | schritte[i];

        i++;
        if (i >= 4)
        {
            i = 0;
        }

        _delay_ms(3);                // Wartezeit bestimmt die Geschwindigkeit
    }

    return 0;
}
`);

  add('halbschritt', 'Schrittmotor: Halbschritt', `
/*
 * Schrittmotor im Halbschritt-Betrieb
 * Abwechselnd eine und zwei Spulen -> doppelte Auflösung, ruhiger Lauf.
 *
 * Anschluss (ULN2003-Treiber):  IN1=PB0  IN2=PB1  IN3=PB2  IN4=PB3
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

#define ANZAHL 8

const uint8_t halbschritt[ANZAHL] = {
    0b0001, 0b0011, 0b0010, 0b0110,
    0b0100, 0b1100, 0b1000, 0b1001
};

int main(void)
{
    uint8_t i = 0;

    DDRB |= 0x0F;

    while (1)
    {
        PORTB = (PORTB & 0xF0) | halbschritt[i];
        i = (i + 1) % ANZAHL;        // 0,1,2,...,7,0,1,...
        _delay_ms(2);
    }

    return 0;
}
`);

  add('wellenschritt', 'Schrittmotor: Wellenschritt (eine Spule)', `
/*
 * Wellenschritt: immer nur EINE Spule an.
 * Braucht wenig Strom, hat aber weniger Kraft als der Vollschritt.
 * Hier mit Bit-Schieben statt Tabelle.
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    uint8_t muster = 0b0001;

    DDRB |= 0x0F;

    while (1)
    {
        PORTB = (PORTB & 0xF0) | muster;

        muster = muster << 1;        // nächste Spule
        if (muster > 0b1000)
        {
            muster = 0b0001;
        }

        _delay_ms(4);
    }

    return 0;
}
`);

  add('umdrehung', 'Eine Umdrehung hin und zurück', `
/*
 * Der Motor dreht genau eine Umdrehung rechts herum,
 * wartet eine Sekunde und dreht dann zurück.
 *
 * 28BYJ-48: 2048 Vollschritte pro Umdrehung (mit Getriebe)
 * (Bei einem anderen Motor die Zahl unten anpassen, z. B. 200.)
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

#define SCHRITTE_PRO_UMDREHUNG 2048

const uint8_t vollschritt[4] = { 0b0011, 0b0110, 0b1100, 0b1001 };

// Einen Schritt machen: richtung = +1 (rechts) oder -1 (links)
void schritt(int8_t richtung)
{
    static uint8_t pos = 0;          // merkt sich die Position

    pos = (pos + richtung) & 0x03;   // bleibt immer 0..3
    PORTB = (PORTB & 0xF0) | vollschritt[pos];
    _delay_ms(3);
}

void drehen(int16_t schritte)
{
    int8_t richtung = 1;

    if (schritte < 0)
    {
        richtung = -1;
        schritte = -schritte;
    }

    for (int16_t i = 0; i < schritte; i++)
    {
        schritt(richtung);
    }
}

int main(void)
{
    DDRB |= 0x0F;

    while (1)
    {
        drehen(SCHRITTE_PRO_UMDREHUNG);     // eine Umdrehung rechts
        PORTB &= 0xF0;                      // Spulen aus (spart Strom)
        _delay_ms(1000);

        drehen(-SCHRITTE_PRO_UMDREHUNG);    // eine Umdrehung links
        PORTB &= 0xF0;
        _delay_ms(1000);
    }

    return 0;
}
`);

  add('taster', 'Taster: links / rechts drehen', `
/*
 * Solange Taster S1 gedrückt ist, dreht der Motor links,
 * solange S2 gedrückt ist, dreht er rechts.
 *
 * Taster S1 an PD2, S2 an PD3 (schalten nach GND).
 * Deshalb: interne Pull-up-Widerstände einschalten!
 * Gedrückt = 0, losgelassen = 1
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

const uint8_t vollschritt[4] = { 0b0011, 0b0110, 0b1100, 0b1001 };

int main(void)
{
    uint8_t pos = 0;

    DDRB |= 0x0F;                          // Motor: Ausgänge
    DDRD &= ~((1 << PD2) | (1 << PD3));    // Taster: Eingänge
    PORTD |= (1 << PD2) | (1 << PD3);      // Pull-ups ein

    while (1)
    {
        if (!(PIND & (1 << PD2)))          // S1 gedrückt?
        {
            pos = (pos - 1) & 0x03;
            PORTB = (PORTB & 0xF0) | vollschritt[pos];
            _delay_ms(3);
        }
        else if (!(PIND & (1 << PD3)))     // S2 gedrückt?
        {
            pos = (pos + 1) & 0x03;
            PORTB = (PORTB & 0xF0) | vollschritt[pos];
            _delay_ms(3);
        }
        else
        {
            PORTB &= 0xF0;                 // nichts gedrückt: Spulen aus
        }
    }

    return 0;
}
`);

  add('poti', 'Geschwindigkeit mit Poti (ADC)', `
/*
 * Das Potentiometer an PC0 (ADC0) stellt die Geschwindigkeit ein.
 * Links = langsam, rechts = schnell.
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

const uint8_t vollschritt[4] = { 0b0011, 0b0110, 0b1100, 0b1001 };

void adc_init(void)
{
    ADMUX  = (1 << REFS0);                           // Referenz = AVCC (5 V), Kanal 0
    ADCSRA = (1 << ADEN) | (1 << ADPS1) | (1 << ADPS0); // ADC an, Vorteiler 8
}

uint16_t adc_lesen(uint8_t kanal)
{
    ADMUX = (ADMUX & 0xF0) | (kanal & 0x0F);
    ADCSRA |= (1 << ADSC);                  // Messung starten
    while (ADCSRA & (1 << ADSC))            // warten bis fertig
    {
    }
    return ADCW;                            // 0 ... 1023
}

int main(void)
{
    uint8_t pos = 0;
    uint16_t wert;
    uint8_t wartezeit;

    DDRB |= 0x0F;
    adc_init();

    while (1)
    {
        wert = adc_lesen(0);
        wartezeit = 2 + (1023 - wert) / 32;  // 2 ms (schnell) ... 33 ms (langsam)

        pos = (pos + 1) & 0x03;
        PORTB = (PORTB & 0xF0) | vollschritt[pos];

        // _delay_ms() braucht beim echten Compiler eine Konstante,
        // deshalb warten wir in einer Schleife je 1 ms:
        for (uint8_t i = 0; i < wartezeit; i++)
        {
            _delay_ms(1);
        }
    }

    return 0;
}
`);

  add('timer', 'Timer-Interrupt (Timer1, CTC)', `
/*
 * Der Motor wird im Hintergrund vom Timer1 gesteuert:
 * Alle 4 ms löst der Timer einen Interrupt aus und die ISR macht einen Schritt.
 * Das Hauptprogramm ist frei für andere Aufgaben.
 *
 * Rechnung: 1 MHz / 8 (Vorteiler) = 125000 Takte pro Sekunde
 *           4 ms -> 125000 * 0,004 = 500  -> OCR1A = 500 - 1
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <avr/interrupt.h>

const uint8_t vollschritt[4] = { 0b0011, 0b0110, 0b1100, 0b1001 };
volatile uint8_t pos = 0;
volatile uint16_t anzahl = 0;

ISR(TIMER1_COMPA_vect)
{
    pos = (pos + 1) & 0x03;
    PORTB = (PORTB & 0xF0) | vollschritt[pos];
    anzahl++;
}

int main(void)
{
    DDRB |= 0x0F;

    TCCR1B = (1 << WGM12) | (1 << CS11);   // CTC-Modus, Vorteiler 8
    OCR1A  = 500 - 1;                      // alle 4 ms
    TIMSK |= (1 << OCIE1A);                // Compare-Interrupt erlauben
    sei();                                 // Interrupts global ein

    while (1)
    {
        // Hauptprogramm hat nichts zu tun
    }

    return 0;
}
`);

  add('int0', 'Taster-Interrupt: Richtung wechseln', `
/*
 * Mit jedem Druck auf Taster S1 (PD2 = INT0) ändert der Motor die Drehrichtung.
 * Der Taster wird per externem Interrupt erkannt (fallende Flanke).
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <avr/interrupt.h>
#include <util/delay.h>

const uint8_t vollschritt[4] = { 0b0011, 0b0110, 0b1100, 0b1001 };
volatile int8_t richtung = 1;

ISR(INT0_vect)
{
    richtung = -richtung;
}

int main(void)
{
    uint8_t pos = 0;

    DDRB |= 0x0F;
    DDRD &= ~(1 << PD2);
    PORTD |= (1 << PD2);                   // Pull-up für den Taster

    MCUCR |= (1 << ISC01);                 // INT0 bei fallender Flanke
    GICR  |= (1 << INT0);                  // INT0 erlauben
    sei();

    while (1)
    {
        pos = (pos + richtung) & 0x03;
        PORTB = (PORTB & 0xF0) | vollschritt[pos];
        _delay_ms(4);
    }

    return 0;
}
`);

  add('uart', 'UART: Schritte zählen und ausgeben', `
/*
 * Der Motor macht eine viertel Umdrehung (512 Schritte) und
 * schickt danach den Zählerstand über die serielle Schnittstelle.
 * -> Reiter "Seriell" unten rechts öffnen!
 *
 * UART: 9600 Baud bei 1 MHz mit U2X (doppelte Geschwindigkeit)
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>
#include <stdlib.h>

const uint8_t vollschritt[4] = { 0b0011, 0b0110, 0b1100, 0b1001 };

void uart_init(void)
{
    UCSRA = (1 << U2X);
    UBRRH = 0;
    UBRRL = 12;                                        // 9600 Baud
    UCSRB = (1 << TXEN);                               // Sender ein
    UCSRC = (1 << URSEL) | (1 << UCSZ1) | (1 << UCSZ0); // 8N1
}

void uart_putc(char c)
{
    while (!(UCSRA & (1 << UDRE)))     // warten bis Sender frei
    {
    }
    UDR = c;
}

void uart_puts(const char *s)
{
    while (*s)
    {
        uart_putc(*s);
        s++;
    }
}

int main(void)
{
    uint8_t pos = 0;
    uint32_t gesamt = 0;
    char text[12];

    DDRB |= 0x0F;
    uart_init();
    uart_puts("Schrittmotor bereit\\r\\n");

    while (1)
    {
        for (uint16_t i = 0; i < 512; i++)
        {
            pos = (pos + 1) & 0x03;
            PORTB = (PORTB & 0xF0) | vollschritt[pos];
            gesamt++;
            _delay_ms(3);
        }

        ultoa(gesamt, text, 10);
        uart_puts("Schritte: ");
        uart_puts(text);
        uart_puts("\\r\\n");
        _delay_ms(500);
    }

    return 0;
}
`);

  add('lauflicht', 'LED-Lauflicht an PORTD', `
/*
 * Einstieg ohne Motor: Lauflicht mit den 8 LEDs an PORTD.
 * (LED-Zeile in den Einstellungen auf Port D stellen.)
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

int main(void)
{
    uint8_t led = 0x01;

    DDRD = 0xFF;                 // ganzer Port D ist Ausgang

    while (1)
    {
        PORTD = led;
        _delay_ms(150);

        led = led << 1;
        if (led == 0)
        {
            led = 0x01;
        }
    }

    return 0;
}
`);

  add('rampe', 'Sanft anfahren und bremsen (Rampe)', `
/*
 * Ein Schrittmotor kann nicht sofort schnell loslaufen.
 * Deshalb wird die Wartezeit langsam verkleinert (anfahren) und
 * am Ende wieder vergrößert (bremsen).
 * Tipp: Ohne Rampe mit 1 ms startet der Motor nicht -> ausprobieren!
 */
#define F_CPU 1000000UL
#include <avr/io.h>
#include <util/delay.h>

const uint8_t vollschritt[4] = { 0b0011, 0b0110, 0b1100, 0b1001 };
uint8_t pos = 0;

void schritt(uint8_t wartezeit_ms)
{
    pos = (pos + 1) & 0x03;
    PORTB = (PORTB & 0xF0) | vollschritt[pos];
    while (wartezeit_ms > 0)
    {
        _delay_ms(1);
        wartezeit_ms--;
    }
}

int main(void)
{
    uint8_t t;
    uint16_t i;

    DDRB |= 0x0F;

    while (1)
    {
        for (t = 10; t > 1; t--)         // anfahren: 10 ms ... 2 ms
        {
            for (i = 0; i < 40; i++) schritt(t);
        }
        for (i = 0; i < 1500; i++)       // volle Fahrt
        {
            schritt(2);
        }
        for (t = 2; t <= 10; t++)        // bremsen
        {
            for (i = 0; i < 40; i++) schritt(t);
        }
        PORTB &= 0xF0;
        _delay_ms(1000);
    }

    return 0;
}
`);

  // ===================== Assembler =====================
  const addA = (id, title, code, cfg, cfgText) => EX.push({ id, title, lang: 'asm', code: code.replace(/^\n/, ''), cfg, cfgText });
  const KLAUSUR = { driver: 'l293', s1: 'PC0', s2: 'PC1', potCh: -1, extPullup: false };
  const KLAUSUR_TXT = 'Motor über L293D an PB0…PB3, Taster S1 an PC0, S2 an PC1';

  addA('asm_vorlage', 'Leere Vorlage (Assembler)', `
; Mein Programm
; Motor an PORTB, Taster an PORTC

.include "m8def.inc"

        ldi r16, HIGH(RAMEND)   ; Stackpointer setzen
        out SPH, r16            ; (nötig für rcall / ret)
        ldi r16, LOW(RAMEND)
        out SPL, r16

        ldi r16, 0b00001111
        out DDRB, r16           ; PB0..PB3 Ausgang

mainloop:
        ; hier kommt dein Programm hin

        rjmp mainloop
`, KLAUSUR, KLAUSUR_TXT);

  addA('asm_halbschritt', 'Halbschritt mit Tastern (wie Klausur)', `
; Schrittmotor im Halbschritt-Betrieb
;
; C0 -> T1 -> S1 -> Hauptschalter
; C1 -> T2 -> S2 -> Rechtsbetrieb
; PortB -> Motor (L293D: PB0=A1, PB1=A2, PB2=B1, PB3=B2)
;
; Der Motor läuft nur, solange S1 UND S2 gedrückt sind.
; r19 ist ein "Lauf-Bit": Es wandert von Bit 0 bis Bit 7,
; jedes Bit steht für einen der 8 Halbschritte.

.include "m8def.inc"

main:
        ldi r18, HIGH(RAMEND)   ; Stackpointer setzen
        out SPH, r18
        ldi r18, LOW(RAMEND)
        out SPL, r18

        ldi r18, 0b00000000
        out DDRC, r18           ; PortC auf Eingang
        ldi r18, 0b11111111
        out PORTC, r18          ; PortC Pull-ups ein
        out DDRB, r18           ; PortB auf Ausgang

        ldi r19, 0b00000001     ; Counter (Lauf-Bit)
        ldi r20, 0b00000000     ; Phasenwerte

mainloop:
        sbic PINC, 0            ; Wenn T1 nicht gedrückt (Pin = 1)
        rjmp mainloop           ; dann zurück zum Start

        sbic PINC, 1            ; Wenn T2 nicht gedrückt
        rjmp mainloop           ; dann zurück zum Start

        lsl r19                 ; Lauf-Bit eins weiter
        cpi r19, 0              ; rausgeschoben?
        breq counter_begin      ; dann wieder bei Bit 0 anfangen

stepper:
        sbrc r19, 0
        ldi r20, 0b00000001     ; Schritt 1
        sbrc r19, 1
        ldi r20, 0b00000101     ; Schritt 2
        sbrc r19, 2
        ldi r20, 0b00000100     ; Schritt 3
        sbrc r19, 3
        ldi r20, 0b00000110     ; Schritt 4
        sbrc r19, 4
        ldi r20, 0b00000010     ; Schritt 5
        sbrc r19, 5
        ldi r20, 0b00001010     ; Schritt 6
        sbrc r19, 6
        ldi r20, 0b00001000     ; Schritt 7
        sbrc r19, 7
        ldi r20, 0b00001001     ; Schritt 8

        out PORTB, r20          ; Muster an den Motor

        rcall Wait10ms          ; kleine Wartezeit (eingebaut)
        rjmp mainloop

counter_begin:
        ldi r19, 0b00000001     ; Counter wieder auf 1
        rjmp stepper
`, KLAUSUR, KLAUSUR_TXT);

  addA('asm_richtung', 'Links / rechts mit zwei Tastern', `
; S1 (PC0) gedrückt -> Motor dreht links
; S2 (PC1) gedrückt -> Motor dreht rechts
; nichts gedrückt   -> Spulen aus
;
; Die 8 Halbschritte stehen in einer Tabelle im Flash
; und werden mit lpm gelesen.

.include "m8def.inc"
.def temp  = r16
.def pos   = r17            ; Position 0..7 in der Tabelle

        ldi temp, HIGH(RAMEND)
        out SPH, temp
        ldi temp, LOW(RAMEND)
        out SPL, temp

        ser temp
        out DDRB, temp          ; PortB Ausgang
        clr temp
        out DDRC, temp          ; PortC Eingang
        ser temp
        out PORTC, temp         ; Pull-ups ein
        clr pos

loop:
        sbis PINC, 0            ; S1 gedrückt? (Pin = 0)
        rjmp links
        sbis PINC, 1            ; S2 gedrückt?
        rjmp rechts
        clr temp
        out PORTB, temp         ; Spulen aus
        rjmp loop

links:
        dec pos
        rjmp schritt
rechts:
        inc pos
schritt:
        andi pos, 0x07          ; nur 0..7
        ldi ZL, LOW(tabelle*2)  ; Z zeigt auf die Tabelle
        ldi ZH, HIGH(tabelle*2)
        add ZL, pos             ; + Position
        clr temp
        adc ZH, temp
        lpm temp, Z             ; Muster holen
        out PORTB, temp
        rcall warte5ms
        rjmp loop

; Eigene Warteschleife: 5 ms bei 1 MHz
; (4 Takte pro Durchlauf * 1250 = 5000 Takte)
warte5ms:
        push r24
        push r25
        ldi r24, LOW(1250)
        ldi r25, HIGH(1250)
w5:     sbiw r24, 1             ; 2 Takte
        brne w5                 ; 2 Takte
        pop r25
        pop r24
        ret

tabelle:
        .db 0b0001, 0b0101, 0b0100, 0b0110, 0b0010, 0b1010, 0b1000, 0b1001
`, KLAUSUR, KLAUSUR_TXT);

  addA('asm_timer', 'Timer-Interrupt (Assembler)', `
; Der Timer1 löst alle 5 ms einen Interrupt aus,
; die ISR macht jeweils einen Halbschritt.
; Das Hauptprogramm hat nichts mehr zu tun.
;
; 1 MHz / 8 = 125000 Takte/s -> 5 ms = 625 -> OCR1A = 624

.include "m8def.inc"
.def temp = r16
.def pos  = r17

.org 0x000
        rjmp reset              ; Reset-Vektor
.org OC1Aaddr
        rjmp isr_timer          ; Timer1 Compare A

reset:
        ldi temp, HIGH(RAMEND)
        out SPH, temp
        ldi temp, LOW(RAMEND)
        out SPL, temp

        ser temp
        out DDRB, temp
        clr pos

        ldi temp, HIGH(624)
        out OCR1AH, temp        ; erst High-Byte schreiben!
        ldi temp, LOW(624)
        out OCR1AL, temp
        ldi temp, (1<<WGM12)|(1<<CS11)  ; CTC, Vorteiler 8
        out TCCR1B, temp
        ldi temp, 1<<OCIE1A     ; Compare-Interrupt erlauben
        out TIMSK, temp
        sei                     ; Interrupts global ein

ende:   rjmp ende               ; nichts zu tun

isr_timer:
        push temp
        in temp, SREG           ; Statusregister sichern
        push temp

        inc pos
        andi pos, 0x07
        ldi ZL, LOW(tabelle*2)
        ldi ZH, HIGH(tabelle*2)
        add ZL, pos
        clr temp
        adc ZH, temp
        lpm temp, Z
        out PORTB, temp

        pop temp
        out SREG, temp
        pop temp
        reti

tabelle:
        .db 0b0001, 0b0101, 0b0100, 0b0110, 0b0010, 0b1010, 0b1000, 0b1001
`, KLAUSUR, KLAUSUR_TXT);

  addA('asm_lauflicht', 'LED-Lauflicht an PORTD (Assembler)', `
; Lauflicht mit den LEDs an PORTD
; (LED-Zeile unter "Schaltung" auf PORTD stellen)

.include "m8def.inc"

        ldi r16, HIGH(RAMEND)
        out SPH, r16
        ldi r16, LOW(RAMEND)
        out SPL, r16

        ser r16
        out DDRD, r16           ; PortD Ausgang
        ldi r17, 0b00000001

loop:
        out PORTD, r17
        rcall Wait100ms         ; eingebaute Warteschleife
        lsl r17                 ; LED eins weiter
        brne loop               ; noch nicht rausgeschoben?
        ldi r17, 0b00000001     ; wieder von vorn
        rjmp loop
`, { ledPort: 'D' }, 'LED-Zeile an PORTD');

  G.AVR_EXAMPLES = EX;
})(typeof window !== 'undefined' ? window : globalThis);
