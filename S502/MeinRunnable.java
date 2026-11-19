// Seite 502: Mit Thread.sleep() das Programm vorhersagbar machen
public class MeinRunnable implements Runnable {

    public void run() {
        los();
    }

    public void los() {
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

class ThreadTestlauf {
    public static void main(String[] args) {
        Runnable threadJob = new MeinRunnable();
        Thread meinThread = new Thread(threadJob);
        meinThread.start();
        System.out.println("zurück in main");
    }
}
