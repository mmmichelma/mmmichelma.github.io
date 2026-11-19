/*
 * Kompilieren: javac -encoding UTF-8 *.java
 * Starten:     java MeinThreadMitRunnableStart
 *
 * main ist nach 50 Durchläufen fertig, der neue Thread zählt danach
 * allein weiter bis 249. Das Programm endet erst, wenn alle Threads fertig sind.
 */
public class MeinThreadMitRunnableStart {

  public static void main(String[] args) {
    MeinRunnable threadJob = new MeinRunnable();
    Thread t1 = new Thread(threadJob);
    System.out.println("Gleich wird der Thread gestartet.");
    System.out.println();
    t1.start();
    System.out.println("Zurück in der main-Methode.");
    for (int i = 0; i < 50; i++) {
      System.out.println("main-Methode");
      try {
        Thread.sleep(5);
      } catch (Exception e) {
      }
    }
  }
}
