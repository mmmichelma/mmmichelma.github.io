// Seite 494 / 498: Einen Job für den Thread erzeugen (Interface Runnable)
public class MeinRunnable implements Runnable {

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

class ThreadTestlauf {

    public static void main(String[] args) {
        Runnable threadJob = new MeinRunnable();
        Thread meinThread = new Thread(threadJob);

        meinThread.start();

        System.out.println("zurück in main");
    }
}
