import java.io.*;
import java.net.*;
import java.util.ArrayList;

/**
 * Einfacher Chat-Server (ohne Threads).
 * Wartet in einer Schleife mit accept() auf Clients, nimmt jeweils eine
 * Nachricht entgegen und schickt alle bisher empfangenen Nachrichten zurück.
 */
public class ChatServer {

    public static final int PORT = 5000;
    private ArrayList<String> nachrichten = new ArrayList<String>();

    public static void main(String[] args) {
        new ChatServer().los();
    }

    public void los() {
        try (ServerSocket serverSock = new ServerSocket(PORT)) {
            System.out.println("ChatServer gestartet an Port " + PORT);

            while (true) {
                Socket sock = serverSock.accept();
                System.out.println("Ein Client hat eine Verbindung hergestellt");

                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(sock.getInputStream(), "UTF-8"));
                PrintWriter writer = new PrintWriter(
                        new OutputStreamWriter(sock.getOutputStream(), "UTF-8"), true);

                String nachricht = reader.readLine();
                System.out.println("Daten wurden empfangen: " + nachricht);

                // Nur echte Nachrichten speichern (nicht "Name: " bei RETURN)
                if (nachricht != null && !nachricht.trim().endsWith(":")) {
                    nachrichten.add(nachricht);
                }

                // Alle bisherigen Nachrichten zurück an den Client (Tab-getrennt)
                writer.println(String.join("\t", nachrichten));
                sock.close();
            }
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }
}
