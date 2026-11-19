import java.io.*;
import java.net.*;
import java.util.ArrayList;

/**
 * Erweiterung: Chat-Server mit Threads.
 * Für jeden Client läuft ein eigener Thread (ClientHandler), der dessen
 * Nachrichten liest und sofort an alle verbundenen Clients weiterleitet.
 */
public class ChatServer {

    public static final int PORT = 5000;
    private ArrayList<PrintWriter> clientAusgaben = new ArrayList<PrintWriter>();

    public static void main(String[] args) {
        new ChatServer().los();
    }

    public void los() {
        try (ServerSocket serverSock = new ServerSocket(PORT)) {
            System.out.println("ChatServer (mit Threads) gestartet an Port " + PORT);
            while (true) {
                Socket clientSocket = serverSock.accept();
                PrintWriter writer = new PrintWriter(
                        new OutputStreamWriter(clientSocket.getOutputStream(), "UTF-8"), true);
                synchronized (clientAusgaben) {
                    clientAusgaben.add(writer);
                }
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

    /** Job für einen Thread: liest die Nachrichten eines Clients. */
    public class ClientHandler implements Runnable {
        private Socket sock;
        private PrintWriter writer;
        private BufferedReader reader;

        public ClientHandler(Socket clientSocket, PrintWriter writer) throws IOException {
            this.sock = clientSocket;
            this.writer = writer;
            this.reader = new BufferedReader(
                    new InputStreamReader(sock.getInputStream(), "UTF-8"));
        }

        public void run() {
            String nachricht;
            try {
                while ((nachricht = reader.readLine()) != null) {
                    System.out.println("Daten wurden empfangen: " + nachricht);
                    anAlleSenden(nachricht);
                }
            } catch (IOException ex) {
                // Client hat die Verbindung beendet
            } finally {
                synchronized (clientAusgaben) {
                    clientAusgaben.remove(writer);
                }
                System.out.println("Ein Client hat die Verbindung beendet");
            }
        }
    }
}
