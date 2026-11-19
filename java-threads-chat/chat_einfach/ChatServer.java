import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/*
 * Einfacher Chat-Server (Arbeitsblatt "Chat-Server", vereinfachte Version ohne Threads)
 *
 * Der Server wartet in einer Schleife mit accept() auf Anfragen.
 * Pro Verbindung:
 *   1. eine Zeile vom Client lesen ("Name: Nachricht")
 *   2. Nachricht speichern
 *   3. ALLE bisher empfangenen Nachrichten zurück an den Client senden
 *   4. Verbindung schließen
 *
 * Kompilieren: javac ChatServer.java
 * Starten:     java ChatServer        (Port 5000)
 *              java ChatServer 6000   (anderer Port)
 */
public class ChatServer {

    private final ArrayList<String> nachrichten = new ArrayList<>();

    public static void main(String[] args) {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 5000;
        new ChatServer().los(port);
    }

    public void los(int port) {
        try (ServerSocket serverSock = new ServerSocket(port)) {
            System.out.println("ChatServer gestartet an Port " + port);

            while (true) {
                // blockiert, bis sich ein Client verbindet
                try (Socket sock = serverSock.accept()) {
                    System.out.println("Ein Client hat eine Verbindung hergestellt");

                    BufferedReader reader = new BufferedReader(
                            new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));
                    PrintWriter writer = new PrintWriter(
                            new OutputStreamWriter(sock.getOutputStream(), StandardCharsets.UTF_8), true);

                    String nachricht = reader.readLine();
                    if (nachricht != null) {
                        System.out.println("Daten wurden empfangen: " + nachricht);
                        nachrichten.add(nachricht);
                    }

                    // alle bisherigen Nachrichten in einer Zeile, getrennt durch Tabulatoren
                    writer.println(String.join("\t", nachrichten));
                } catch (IOException ex) {
                    System.out.println("Fehler bei der Verbindung: " + ex.getMessage());
                }
            }
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }
}
