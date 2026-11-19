import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/*
 * Erweiterung: Chat-Server MIT Threads
 *
 * Der main-Thread wartet mit accept() auf neue Clients.
 * Für jeden Client wird ein eigener Thread (ClientHandler) gestartet,
 * der dessen Nachrichten liest und sofort an ALLE Clients weiterleitet.
 * Die Clients müssen also nicht mehr nachfragen ("RETURN drücken").
 *
 * Kompilieren: javac ThreadChatServer.java
 * Starten:     java ThreadChatServer        (Port 5000)
 */
public class ThreadChatServer {

    // Ausgabeströme aller verbundenen Clients.
    // Mehrere Threads greifen darauf zu -> Zugriffe mit synchronized schützen!
    private final ArrayList<PrintWriter> clientAusgaben = new ArrayList<>();

    public static void main(String[] args) {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 5000;
        new ThreadChatServer().los(port);
    }

    public void los(int port) {
        try (ServerSocket serverSock = new ServerSocket(port)) {
            System.out.println("ThreadChatServer gestartet an Port " + port);

            while (true) {
                Socket clientSocket = serverSock.accept();
                PrintWriter writer = new PrintWriter(
                        new OutputStreamWriter(clientSocket.getOutputStream(), StandardCharsets.UTF_8), true);
                synchronized (clientAusgaben) {
                    clientAusgaben.add(writer);
                }

                // Job (Runnable) erzeugen, Thread erzeugen, Thread starten – wie im Buch S. 492
                Thread t = new Thread(new ClientHandler(clientSocket, writer));
                t.start();
                System.out.println("Ein Client hat eine Verbindung hergestellt");
            }
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }

    /** Schickt eine Nachricht an alle verbundenen Clients. */
    private void anAlleSenden(String nachricht) {
        synchronized (clientAusgaben) {
            for (PrintWriter writer : clientAusgaben) {
                writer.println(nachricht);
            }
        }
    }

    /** Der Job eines Client-Threads: Nachrichten dieses Clients lesen und verteilen. */
    private class ClientHandler implements Runnable {
        private final Socket sock;
        private final PrintWriter writer;

        ClientHandler(Socket sock, PrintWriter writer) {
            this.sock = sock;
            this.writer = writer;
        }

        public void run() {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8))) {
                String nachricht;
                // readLine() blockiert diesen Thread, bis Daten da sind – die anderen laufen weiter
                while ((nachricht = reader.readLine()) != null) {
                    System.out.println("Daten wurden empfangen: " + nachricht);
                    anAlleSenden(nachricht);
                }
            } catch (IOException ex) {
                // Client hat die Verbindung abgebrochen
            } finally {
                synchronized (clientAusgaben) {
                    clientAusgaben.remove(writer);
                }
                try {
                    sock.close();
                } catch (IOException ignored) {
                }
                System.out.println("Ein Client hat die Verbindung beendet");
            }
        }
    }
}
