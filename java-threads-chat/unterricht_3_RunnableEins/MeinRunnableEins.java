/*
 * Unterricht (Kinz): Runnable, das den Namen des laufenden Threads ausgibt
 */
public class MeinRunnableEins implements Runnable {

  // Implementieren der Methode run des Interfaces Runnable
  public void run() {
    for (int i = 0; i < 100; i++) {
      //System.out.println("Thread 1");
      System.out.println(Thread.currentThread().getName());
      try {
        Thread.sleep(5);
      } catch (Exception e) {

      } finally {

      } // end of try
    }
  }
}
