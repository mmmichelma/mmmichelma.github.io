# Datenkommunikation – Threads & Chat-Server

## Hausaufgabe Threads (Java von Kopf bis Fuß, Kap. 15)

| Ordner | Seite | Inhalt | Starten |
|---|---|---|---|
| `S494_498` | 494 / 498 | Runnable-Job, neuer Thread (Reihenfolge zufällig) | `javac MeinRunnable.java && java ThreadTestlauf` |
| `S502` | 502 | Wie S. 494, aber mit `Thread.sleep(2000)` → „zurück in main“ immer zuerst | `javac MeinRunnable.java && java ThreadTestlauf` |
| `S503` | 503 | Zwei Threads (Alpha/Beta) mit demselben Runnable | `javac ZweiThreads.java && java ZweiThreads` |

## Arbeitsblatt 08 – Einfacher Chat-Server

### `ChatServer/einfach` (Grundversion laut Arbeitsblatt)
- **Server** wartet in einer Schleife mit `accept()`, empfängt eine Nachricht und schickt
  alle bisherigen Nachrichten an den aufrufenden Client zurück (Port 5000).
- **Client** fragt den Namen ab. RETURN = nur Nachrichten abholen, Text = senden.

```
cd ChatServer/einfach
javac *.java
java ChatServer          # Fenster 1
java ChatClient          # Fenster 2 (z. B. Lara)
java ChatClient          # Fenster 3 (z. B. Benny)
```
Anderer Rechner: `java ChatClient <IP-des-Servers>`

### `ChatServer/mitThreads` (Erweiterung)
- Server startet pro Client einen eigenen Thread (`ClientHandler`) und leitet jede
  Nachricht sofort an alle Clients weiter.
- Client nutzt einen zweiten Thread (`EingangsLeser`) zum Empfangen – Nachrichten
  erscheinen ohne RETURN. Beenden mit `/exit`.

Gleiche Befehle wie oben, nur im Ordner `ChatServer/mitThreads`.

> Hinweis Windows-Konsole: Bei Umlaut-Problemen vorher `chcp 65001` ausführen
> und mit `javac -encoding UTF-8 *.java` kompilieren.
