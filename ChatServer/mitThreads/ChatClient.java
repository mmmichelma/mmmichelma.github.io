import java.io.*;
import java.net.*;
import java.util.Scanner;

/**
 * Erweiterung: Chat-Client mit Threads.
 * Der main-Thread liest Eingaben von der Tastatur und sendet sie,
 * ein zweiter Thread (EingangsLeser) empfängt gleichzeitig Nachrichten vom Server.
 * Mit "/exit" wird der Client beendet.
 */
public class ChatClient {

    private Socket sock;
    private BufferedReader reader;
    private PrintWriter writer;

    public static void main(String[] args) {
        String host = args.length > 0 ? args[0] : "127.0.0.1";
        new ChatClient().los(host);
    }

    public void los(String host) {
        Scanner tastatur = new Scanner(System.in, "UTF-8");
        System.out.print("Ihr Name: ");
        String name = tastatur.nextLine().trim();

        try {
            sock = new Socket(host, ChatServer.PORT);
            reader = new BufferedReader(new InputStreamReader(sock.getInputStream(), "UTF-8"));
            writer = new PrintWriter(new OutputStreamWriter(sock.getOutputStream(), "UTF-8"), true);
            System.out.println("Verbindung hergestellt. Nachrichten eingeben (/exit zum Beenden):");
        } catch (IOException ex) {
            System.out.println("Keine Verbindung zum Server: " + ex.getMessage());
            return;
        }

        Thread leseThread = new Thread(new EingangsLeser());
        leseThread.setDaemon(true);
        leseThread.start();

        while (tastatur.hasNextLine()) {
            String eingabe = tastatur.nextLine();
            if (eingabe.equals("/exit")) break;
            if (!eingabe.isEmpty()) writer.println(name + ": " + eingabe);
        }
        try { sock.close(); } catch (IOException ex) { }
    }

    /** Job für den zweiten Thread: Nachrichten vom Server ausgeben. */
    public class EingangsLeser implements Runnable {
        public void run() {
            String nachricht;
            try {
                while ((nachricht = reader.readLine()) != null) {
                    System.out.println(nachricht);
                }
            } catch (IOException ex) {
                // Verbindung geschlossen
            }
        }
    }
}
