import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

/*
 * Einfacher Chat-Client (Arbeitsblatt "Chat-Server", ohne Threads)
 *
 * Bei jeder Eingabe baut der Client eine NEUE Verbindung zum Server auf,
 * sendet "Name: Text" und bekommt alle bisherigen Nachrichten zurück.
 * Nur RETURN (leere Eingabe) = Nachrichten abholen.
 *
 * Kompilieren: javac ChatClient.java
 * Starten:     java ChatClient                 (Server auf localhost:5000)
 *              java ChatClient 192.168.0.10    (Server auf anderem Rechner)
 *              java ChatClient 192.168.0.10 6000
 */
public class ChatClient {

    public static void main(String[] args) {
        String host = args.length > 0 ? args[0] : "localhost";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 5000;

        Scanner tastatur = new Scanner(System.in, StandardCharsets.UTF_8);
        System.out.print("Ihr Name: ");
        String name = tastatur.nextLine().trim();

        String eingabe = "";
        while (true) {
            String antwort = sendeUndEmpfange(host, port, name + ": " + eingabe);
            System.out.println(antwort);

            System.out.println();
            System.out.println("Zum Empfangen von Nachrichten bitte RETURN betätigen");
            System.out.println("oder geben Sie eine zu sendende Nachricht ein:");
            if (!tastatur.hasNextLine()) {
                break;
            }
            eingabe = tastatur.nextLine();
        }
    }

    private static String sendeUndEmpfange(String host, int port, String nachricht) {
        try (Socket sock = new Socket(host, port)) {
            PrintWriter writer = new PrintWriter(
                    new OutputStreamWriter(sock.getOutputStream(), StandardCharsets.UTF_8), true);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));

            writer.println(nachricht);
            String antwort = reader.readLine();
            return antwort == null ? "" : antwort;
        } catch (IOException ex) {
            return "Keine Verbindung zum Server: " + ex.getMessage();
        }
    }
}
