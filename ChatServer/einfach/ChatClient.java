import java.io.*;
import java.net.*;
import java.util.Scanner;

/**
 * Einfacher Chat-Client (ohne Threads).
 * Für jede Eingabe wird eine neue Verbindung zum Server aufgebaut,
 * die Nachricht gesendet und der komplette Chatverlauf empfangen.
 */
public class ChatClient {

    private String host;
    private String name;

    public ChatClient(String host, String name) {
        this.host = host;
        this.name = name;
    }

    public static void main(String[] args) {
        Scanner tastatur = new Scanner(System.in, "UTF-8");
        String host = args.length > 0 ? args[0] : "127.0.0.1";
        System.out.print("Ihr Name: ");
        String name = tastatur.nextLine().trim();
        new ChatClient(host, name).los(tastatur);
    }

    public void los(Scanner tastatur) {
        String eingabe = "";
        while (true) {
            String verlauf = senden(name + ": " + eingabe);
            bildschirmLoeschen();
            System.out.println(verlauf);
            System.out.println();
            System.out.println("Zum Empfangen von Nachrichten bitte RETURN betätigen");
            System.out.println("oder geben Sie eine zu sendende Nachricht ein:");
            if (!tastatur.hasNextLine()) break;
            eingabe = tastatur.nextLine();
        }
    }

    /** Baut eine Verbindung auf, sendet die Nachricht und liefert den Verlauf. */
    private String senden(String nachricht) {
        try (Socket sock = new Socket(host, ChatServer.PORT)) {
            PrintWriter writer = new PrintWriter(
                    new OutputStreamWriter(sock.getOutputStream(), "UTF-8"), true);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(sock.getInputStream(), "UTF-8"));
            writer.println(nachricht);
            String antwort = reader.readLine();
            return antwort == null ? "" : antwort;
        } catch (IOException ex) {
            return "Keine Verbindung zum Server: " + ex.getMessage();
        }
    }

    private void bildschirmLoeschen() {
        for (int i = 0; i < 30; i++) System.out.println();
    }
}
