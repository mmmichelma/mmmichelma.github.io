/*
 * Java von Kopf bis Fuß, Kapitel 15, Seite 503
 * Erzeugen und Starten von zwei Threads mit demselben Runnable.
 *
 * Kompilieren: javac ZweiThreads.java
 * Ausführen:   java ZweiThreads
 *
 * Wie oft Alpha und Beta sich abwechseln, entscheidet der Scheduler –
 * jeder Durchlauf kann anders aussehen.
 */
public class ZweiThreads implements Runnable {

    public static void main(String[] args) {
        ZweiThreads aufgabe = new ZweiThreads();   // eine Instanz von Runnable
        Thread alpha = new Thread(aufgabe);        // zwei Threads mit dem gleichen Job
        Thread beta = new Thread(aufgabe);
        alpha.setName("Alpha-Thread");             // Threads Namen geben
        beta.setName("Beta-Thread");
        alpha.start();                             // Threads starten
        beta.start();
    }

    public void run() {
        // Jeder Thread durchläuft diese Schleife und gibt bei jedem Durchgang seinen Namen aus.
        for (int i = 0; i < 25; i++) {
            String threadName = Thread.currentThread().getName();
            System.out.println("jetzt läuft der " + threadName);
        }
    }
}
