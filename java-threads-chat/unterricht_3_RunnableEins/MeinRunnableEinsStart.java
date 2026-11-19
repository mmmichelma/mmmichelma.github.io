/*
 * Startklasse für MeinRunnableEins (war im Unterrichtsmaterial nicht dabei).
 *
 * Kompilieren: javac -encoding UTF-8 *.java
 * Starten:     java MeinRunnableEinsStart
 *
 * Zwei Threads mit demselben Job und eigenen Namen – wie ZweiThreads (Buch S. 503).
 */
public class MeinRunnableEinsStart {

  public static void main(String[] args) {
    MeinRunnableEins job = new MeinRunnableEins();
    Thread t1 = new Thread(job, "Thread 1");
    Thread t2 = new Thread(job, "Thread 2");
    t1.start();
    t2.start();
  }
}
