import javax.swing.*;
import java.awt.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

/*
 * Erweiterung: Chat-Client mit GUI (Swing) und Threads
 *
 * Wie im Buch (S. 489): Ein separater Thread liest die Nachrichten vom Server,
 * damit die Bedienung der GUI nicht blockiert wird.
 *
 * Passt zum ThreadChatServer.
 *
 * Kompilieren: javac ChatClientGUI.java
 * Starten:     java ChatClientGUI [host] [port]
 */
public class ChatClientGUI {

    private JTextArea eingehend;
    private JTextField ausgehend;
    private PrintWriter writer;
    private BufferedReader reader;
    private String name;

    public static void main(String[] args) {
        String host = args.length > 0 ? args[0] : "localhost";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 5000;
        SwingUtilities.invokeLater(() -> new ChatClientGUI().los(host, port));
    }

    public void los(String host, int port) {
        name = JOptionPane.showInputDialog(null, "Ihr Name:", "Chat", JOptionPane.QUESTION_MESSAGE);
        if (name == null || name.isBlank()) {
            return;
        }

        JFrame frame = new JFrame("Chat-Client – " + name);
        eingehend = new JTextArea(15, 40);
        eingehend.setEditable(false);
        eingehend.setLineWrap(true);
        eingehend.setWrapStyleWord(true);

        ausgehend = new JTextField(30);
        JButton senden = new JButton("Senden");
        senden.addActionListener(e -> sende());
        ausgehend.addActionListener(e -> sende());   // ENTER sendet ebenfalls

        JPanel unten = new JPanel(new BorderLayout(5, 5));
        unten.add(ausgehend, BorderLayout.CENTER);
        unten.add(senden, BorderLayout.EAST);

        frame.getContentPane().add(new JScrollPane(eingehend), BorderLayout.CENTER);
        frame.getContentPane().add(unten, BorderLayout.SOUTH);
        frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        frame.pack();
        frame.setLocationByPlatform(true);
        frame.setVisible(true);

        try {
            Socket sock = new Socket(host, port);
            writer = new PrintWriter(
                    new OutputStreamWriter(sock.getOutputStream(), StandardCharsets.UTF_8), true);
            reader = new BufferedReader(
                    new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));
            anzeigen("Verbunden mit " + host + ":" + port);
        } catch (IOException ex) {
            anzeigen("Keine Verbindung zum Server: " + ex.getMessage());
            return;
        }

        Thread leser = new Thread(new EingehendLeser());
        leser.setDaemon(true);
        leser.start();
        ausgehend.requestFocusInWindow();
    }

    private void sende() {
        if (writer != null && !ausgehend.getText().isEmpty()) {
            writer.println(name + ": " + ausgehend.getText());
        }
        ausgehend.setText("");
        ausgehend.requestFocusInWindow();
    }

    /** Änderungen an der GUI immer im Event-Dispatch-Thread von Swing ausführen. */
    private void anzeigen(String text) {
        SwingUtilities.invokeLater(() -> eingehend.append(text + "\n"));
    }

    /** Job des Empfangs-Threads. */
    private class EingehendLeser implements Runnable {
        public void run() {
            try {
                String nachricht;
                while ((nachricht = reader.readLine()) != null) {
                    anzeigen(nachricht);
                }
            } catch (IOException ex) {
                // Verbindung geschlossen
            }
            anzeigen("Verbindung zum Server beendet.");
        }
    }
}
