# AVR-Werkstatt (Windows)

Die Web-App aus `../atmega8` als Windows-Programm (Electron, portable .exe –
keine Installation nötig, läuft offline).

Gebaut wird von `.github/workflows/atmega8-exe.yml` auf einem Windows-Runner.
Die fertige `AVR-Werkstatt.exe` wird als GitHub-Release
`avr-werkstatt-windows` veröffentlicht.

Lokal starten: Ordner `../atmega8` nach `app/` kopieren, dann
`npm install` und `npm start`.
