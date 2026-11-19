/*
 * Unterricht (Kinz): Thread durch Vererbung – "extends Thread"
 */
public class MeinThread extends Thread {

  // Überschreiben der Methode run der Klasse Thread
  public void run() {
    int i = 0;
    for (i = 0; i < 100; i++) {
      System.out.println("MeinThread " + i);
      try {
        Thread.sleep(5);
      }
      catch (Exception e) {
      }
    }
  }
}
