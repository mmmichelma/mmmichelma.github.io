# AVR-Werkstatt (Android)

ATmega8-Entwicklungsumgebung mit Schrittmotor-Simulation als Android-App.
Die App zeigt die Web-App aus `../atmega8` in einem WebView an; die Dateien
werden beim Bauen in die APK kopiert, die App läuft also komplett offline.

Die APK wird von `.github/workflows/atmega8-apk.yml` gebaut und auf `master`
nach `atmega8/avr-werkstatt.apk` gelegt, damit sie über die Website
heruntergeladen werden kann.
