# Burgenduell als Android-App

Dieses Projekt verpackt `../burgenduell/index.html` in eine Android-App (WebView).

## APK über GitHub bauen lassen
Bei jedem Push, der `burgenduell/` oder diesen Ordner ändert, baut der Workflow
`.github/workflows/android-apk.yml` automatisch eine APK.
Auf GitHub unter **Actions → Burgenduell APK → letzter Lauf → Artifacts → burgenduell-apk**
herunterladen, entpacken und die `burgenduell.apk` aufs Handy kopieren.
Beim Installieren muss „Apps aus unbekannten Quellen“ erlaubt werden.

## Selbst bauen (mit Android Studio oder Android SDK)
```
cd burgenduell-android
gradle assembleDebug
# Ergebnis: app/build/outputs/apk/debug/app-debug.apk
```
