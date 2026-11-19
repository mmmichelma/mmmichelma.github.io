/*
 * Java von Kopf bis Fuß, Kapitel 15, Seite 502
 * Mit Thread.sleep() das Programm besser vorhersagbar machen.
 *
 * Kompilieren: javac ThreadTestlauf.java
 * Ausführen:   java ThreadTestlauf
 *
 * Erwartete Ausgabe (jedes Mal gleich):
 *   zurück in main
 *   (ca. 2 Sekunden Pause)
 *   oben auf dem Stack
 */

class MeinRunnable implements Runnable {

    public void run() {
        los();
    }

    public void los() {
        // sleep zwingt den neuen Thread, den Zustand "laufend" zu verlassen.
        // Der main-Thread kommt wieder dran und gibt "zurück in main" aus.
        try {
            Thread.sleep(2000);
        } catch (InterruptedException ex) {
            ex.printStackTrace();
        }

        tuNochMehr();
    }

    public void tuNochMehr() {
        System.out.println("oben auf dem Stack");
    }
}

public class ThreadTestlauf {

    public static void main(String[] args) {
        Runnable threadJob = new MeinRunnable();
        Thread meinThread = new Thread(threadJob);
        meinThread.start();
        System.out.println("zurück in main");
    }
}
