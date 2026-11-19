/*
 * Kompilieren: javac -encoding UTF-8 *.java
 * Starten:     java MeinThreadStart
 *
 * Ausgaben von "MeinThread i" und "main-Methode i" wechseln sich ab,
 * weil beide Threads nach jeder Ausgabe 5 ms schlafen.
 */
public class MeinThreadStart {

  public static void main(String[] args) {
    MeinThread t1 = new MeinThread();
    System.out.println("Gleich wird der Thread gestartet.");
    System.out.println();
    t1.start();
    System.out.println("Zurück in der main-Methode.");
    for (int i = 0; i < 100; i++) {
      System.out.println("main-Methode " + i);
      try {
        Thread.sleep(5);
      } catch (Exception e) {
      } // end of try
    }
  }
}

// Hinweis:
// Die Methode run der Klasse Thread sollte vom Programm niemals direkt
// aufgerufen werden. Um einen Thread zu starten, ist immer start aufzurufen.
// Dadurch wird der neue Thread erzeugt und initialisiert und ruft schließlich
// selbst run auf, um den Anwendungscode auszuführen. Ein direkter Aufruf
// von run würde dagegen keinen neuen Thread erzeugen, sondern wäre ein
// normaler Methodenaufruf wie jeder andere und würde direkt aus dem bereits
// laufenden Thread des Aufrufers erfolgen.
