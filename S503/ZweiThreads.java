// Seite 503: Erzeugen und Starten von zwei Threads
public class ZweiThreads implements Runnable {

    public static void main(String[] args) {
        ZweiThreads aufgabe = new ZweiThreads();
        Thread alpha = new Thread(aufgabe);
        Thread beta = new Thread(aufgabe);
        alpha.setName("Alpha-Thread");
        beta.setName("Beta-Thread");
        alpha.start();
        beta.start();
    }

    public void run() {
        for (int i = 0; i < 25; i++) {
            String threadName = Thread.currentThread().getName();
            System.out.println("jetzt läuft der " + threadName);
        }
    }
}
