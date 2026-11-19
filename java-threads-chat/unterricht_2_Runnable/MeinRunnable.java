/*
 * Unterricht (Kinz): Thread mit einem Job – "implements Runnable"
 */
public class MeinRunnable implements Runnable {

  // Implementieren der Methode run des Interfaces Runnable
  public void run() {
    int i = 0;
    for (i = 0; i < 250; i++) {
      System.out.println(i);
      try {
        Thread.sleep(5);
      } catch (Exception e) {
      }
    }
  }
}
