import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

/*
 * Erweiterung: Chat-Client MIT Threads (Konsole)
 *
 * main-Thread:   liest Eingaben von der Tastatur und sendet sie.
 * Empfangs-Thread: liest "hinter den Kulissen" ständig vom Server
 *                  und gibt neue Nachrichten sofort aus.
 *
 * Passt zum ThreadChatServer.
 *
 * Kompilieren: javac ThreadChatClient.java
 * Starten:     java ThreadChatClient [host] [port]
 * Beenden:     /quit
 */
public class ThreadChatClient {

    public static void main(String[] args) throws IOException {
        String host = args.length > 0 ? args[0] : "localhost";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 5000;

        Scanner tastatur = new Scanner(System.in, StandardCharsets.UTF_8);
        System.out.print("Ihr Name: ");
        String name = tastatur.nextLine().trim();

        Socket sock = new Socket(host, port);
        PrintWriter writer = new PrintWriter(
                new OutputStreamWriter(sock.getOutputStream(), StandardCharsets.UTF_8), true);
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));

        // Empfangs-Thread: als Lambda geschriebenes Runnable
        Thread empfaenger = new Thread(() -> {
            try {
                String nachricht;
                while ((nachricht = reader.readLine()) != null) {
                    System.out.println(nachricht);
                }
            } catch (IOException ex) {
                // Socket wurde geschlossen
            }
            System.out.println("Verbindung zum Server beendet.");
        });
        empfaenger.setDaemon(true);   // beendet sich automatisch mit dem Programm
        empfaenger.start();

        System.out.println("Verbunden mit " + host + ":" + port + " – Nachricht eingeben, /quit zum Beenden");
        while (tastatur.hasNextLine()) {
            String eingabe = tastatur.nextLine();
            if (eingabe.equals("/quit")) {
                break;
            }
            writer.println(name + ": " + eingabe);
        }
        sock.close();
    }
}
