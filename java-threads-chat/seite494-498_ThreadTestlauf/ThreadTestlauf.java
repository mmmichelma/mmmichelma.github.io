/*
 * Java von Kopf bis Fuß, Kapitel 15, Seite 494 und 498
 * Einen Job (Runnable) für einen Thread erzeugen und den Thread starten.
 *
 * Kompilieren: javac ThreadTestlauf.java
 * Ausführen:   java ThreadTestlauf
 *
 * Mehrmals ausführen! Die Reihenfolge von "zurück in main" und
 * "oben auf dem Stack" wechselt zufällig (S. 498), weil der
 * Thread-Scheduler entscheidet, welcher Thread gerade läuft.
 */

class MeinRunnable implements Runnable {

    // Die einzige Methode des Interfaces Runnable.
    // Sie kommt ganz unten auf den Stack des neuen Threads.
    public void run() {
        los();
    }

    public void los() {
        tuNochMehr();
    }

    public void tuNochMehr() {
        System.out.println("oben auf dem Stack");
    }
}

public class ThreadTestlauf {

    public static void main(String[] args) {
        Runnable threadJob = new MeinRunnable();      // 1. der Job
        Thread meinThread = new Thread(threadJob);    // 2. der Arbeiter bekommt den Job

        meinThread.start();                           // 3. erst jetzt gibt es einen neuen Stack

        System.out.println("zurück in main");
    }
}
