/* Hilfetext */
window.AVR_HELP = `
<div class="cols">
<div>
<h3>Erste Schritte</h3>
<ol>
  <li>Oben bei <b>📚 Beispiele</b> ein Programm laden – oder selbst schreiben.</li>
  <li><b>▶ Start</b> (F5) übersetzt das Programm. Fehler erscheinen unten unter <b>Meldungen</b> – ein Klick springt zur Zeile.</li>
  <li>Links siehst du live, welche Pins HIGH (rot) oder LOW (blau) sind und wie sich der Motor dreht.</li>
  <li><b>Tempo</b> verlangsamt die Zeit (z.&nbsp;B. 0,01×), damit du jeden Schritt sehen kannst.</li>
  <li><b>❚❚ Pause</b> und <b>⤵ Schritt</b> (F10) führen das Programm Anweisung für Anweisung aus.</li>
  <li>Klick links neben eine Zeilennummer setzt einen <b style="color:var(--err)">● Haltepunkt</b>: dort hält das Programm an.</li>
  <li>Unter <b>Variablen</b> und <b>Register</b> siehst du alle Werte – am besten bei Pause.</li>
</ol>
<h3>Tastenkürzel</h3>
<table>
<tr><td><kbd>F5</kbd></td><td>Start / Weiter</td></tr>
<tr><td><kbd>Umschalt</kbd>+<kbd>F5</kbd></td><td>Stopp</td></tr>
<tr><td><kbd>F6</kbd></td><td>Pause</td></tr>
<tr><td><kbd>F7</kbd></td><td>Nur prüfen (übersetzen)</td></tr>
<tr><td><kbd>F9</kbd></td><td>Haltepunkt in aktueller Zeile</td></tr>
<tr><td><kbd>F10</kbd></td><td>Einzelschritt</td></tr>
<tr><td><kbd>Strg</kbd>+<kbd>S</kbd></td><td>Im Browser speichern</td></tr>
<tr><td><kbd>Strg</kbd>+<kbd>/</kbd></td><td>Zeile(n) auskommentieren</td></tr>
<tr><td><kbd>1</kbd> / <kbd>2</kbd></td><td>Taster S1 / S2 drücken (außerhalb des Editors)</td></tr>
</table>
<h3>Standard-Schaltung</h3>
<table>
<tr><th>Bauteil</th><th>Pin</th></tr>
<tr><td>Motor-Treiber IN1 … IN4</td><td>PB0 … PB3</td></tr>
<tr><td>Taster S1 / S2 (nach GND)</td><td>PD2 (INT0) / PD3 (INT1)</td></tr>
<tr><td>Potentiometer</td><td>PC0 (ADC0)</td></tr>
<tr><td>8 LEDs</td><td>PORTD</td></tr>
<tr><td>UART senden / empfangen</td><td>PD1 (TXD) / PD0 (RXD)</td></tr>
</table>
<p class="muted small">Alles änderbar unter <b>⚙ Schaltung</b>. Die Taster schalten nach GND: interne Pull-ups mit <code>PORTD |= (1&lt;&lt;PD2);</code> einschalten, gedrückt liest man dann 0.</p>
</div>
<div>
<h3>Schrittmotor – so funktioniert's</h3>
<p>Der Motor hat 4 Spulen-Anschlüsse. Werden sie in der richtigen Reihenfolge eingeschaltet, dreht sich das Magnetfeld – und der Rotor folgt ihm Schritt für Schritt. Rückwärts durch die Tabelle = andere Drehrichtung.</p>
<table>
<tr><th></th><th>Wellenschritt</th><th>Vollschritt</th><th>Halbschritt</th></tr>
<tr><td>1</td><td><code>0001</code></td><td><code>0011</code></td><td><code>0001</code></td></tr>
<tr><td>2</td><td><code>0010</code></td><td><code>0110</code></td><td><code>0011</code></td></tr>
<tr><td>3</td><td><code>0100</code></td><td><code>1100</code></td><td><code>0010</code></td></tr>
<tr><td>4</td><td><code>1000</code></td><td><code>1001</code></td><td><code>0110</code></td></tr>
<tr><td>5–8</td><td></td><td></td><td><code>0100 1100 1000 1001</code></td></tr>
</table>
<p class="muted small">Bits: IN4 IN3 IN2 IN1. Der 28BYJ-48 braucht 2048 Vollschritte für eine Umdrehung der Welle (4096 Halbschritte). Zu kurze Wartezeiten (z.&nbsp;B. &lt; 2 ms) → der Motor kommt nicht mehr mit und verliert Schritte – das zeigt die Simulation an.</p>
<h3>Spickzettel: Bits und Ports</h3>
<pre>DDRB  |=  (1 &lt;&lt; PB0);   // PB0 ist Ausgang
PORTB |=  (1 &lt;&lt; PB0);   // PB0 = HIGH (Bit setzen)
PORTB &amp;= ~(1 &lt;&lt; PB0);   // PB0 = LOW  (Bit löschen)
PORTB ^=  (1 &lt;&lt; PB0);   // PB0 umschalten
if (PIND &amp; (1 &lt;&lt; PD2))  // ist PD2 HIGH?
if (!(PIND &amp; (1 &lt;&lt; PD2))) // ist PD2 LOW (Taster gedrückt)?
PORTB = (PORTB &amp; 0xF0) | muster; // nur Bit 0..3 ändern</pre>
<h3>Was der Simulator kann</h3>
<ul>
<li>C wie bei avr-gcc: <code>char</code>=8, <code>int</code>=16, <code>long</code>=32 Bit, <code>uint8_t</code> … <code>uint32_t</code>, <code>float</code>, Arrays (auch 2D), Zeiger, Funktionen, <code>static</code>, <code>const</code>, <code>enum</code>, <code>typedef</code>, <code>#define</code>-Makros, <code>#if/#ifdef</code></li>
<li><code>if</code>, <code>else</code>, <code>while</code>, <code>do</code>, <code>for</code>, <code>switch</code>, <code>break</code>, <code>continue</code>, <code>return</code></li>
<li><code>_delay_ms()</code>, <code>_delay_us()</code> (nutzen F_CPU – passt der Takt nicht, stimmt die Zeit nicht!)</li>
<li>Ports B, C, D · Timer0 (Überlauf), Timer1 (Normal/CTC/PWM-Zählung, Compare A/B), Timer2 (CTC) · externe Interrupts INT0/INT1 · ADC · UART · <code>ISR(...)</code>, <code>sei()</code>, <code>cli()</code></li>
<li><code>itoa</code>, <code>utoa</code>, <code>ltoa</code>, <code>ultoa</code>, <code>strlen</code>, <code>abs</code>, <code>rand</code>, <code>PROGMEM</code> / <code>pgm_read_byte()</code></li>
</ul>
<p class="muted small">Nicht simuliert: <code>struct</code>, Inline-Assembler, EEPROM, SPI/TWI, PWM-Signale an den Pins. Die Taktzahl pro Anweisung ist geschätzt – Wartezeiten mit _delay_ms() und Timer sind genau.</p>
<h3>Auf den echten Chip</h3>
<pre>avr-gcc -mmcu=atmega8 -Os -o main.elf main.c
avr-objcopy -O ihex main.elf main.hex
avrdude -c usbasp -p m8 -U flash:w:main.hex</pre>
</div>
</div>
`;
