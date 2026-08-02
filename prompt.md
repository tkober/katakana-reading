# Katakana Reading Practice App

Ich möchte eine kleine Web App haben, mit der ich das lesen von Katakana üben möchte. Ich merke immer wieder, dass mir das nach wie vor viele Probleme beim Lesen von japanischen Texten bereitet obwohl ich schon länger übe.
Die App soll ein Wörterbuch mit leichteren und schwereren Wörtern haben um abwechslungsreich zu sein. Mir soll immer nur das Wort in Katakana angezeigt werden und ich soll dann quasi die romanji dazu in ein Antwort-Feld eingeben. 

Bei der Evaluation der Antwort achte bitte nciht nur darauf, ob das Erebnis korrekt ist, sondern auch welche Kana ich richtig erkannt habe und welche nicht. Sodass du mir quasi über die Zeit sagen kannst mit welchen Kana mir mehr liegen und welche nicht.
Du kannst bestimmte Schwierigkeitsgrade definieren in die du das Vokabular einordnest. Sodass du quasi auch tracken kannst auf welchem level ich grade bin. 

Ziel ist es, dass du mir nicht einfach zufällige Wörter hinschmeißt, sondern regelmäßig meinen level auslotest und anpasst, sodass ich immer gefordert bin. Auch sollst du die Statistik über die einzeknen Kana und wie confident ich sie lesen kann dafür nutzen auch gezielt auf meine Schwächen einzugehen.

## UI & UX

In Sachen UI und UX kannst du dich gerne an wanikani orientieren. Aber halte es simpel. Level und Kana Statistiken reichen.
Vielleicht macht es aber auch Sinn hier noch ein wenig die Zeit mit zu tracken die man für die Wörter braucht. Es geht ja darum das (schnelle) Lesen zu üben.


## Profile Data

Du brauchst nich mehrere User zu verwalten. Es gibt immer nur einen einzelnen golbalen user. Tracke einfach wichtige historische daten wie die statistk der Kana und meinen aktuellen Level. Gerne auch in Kombination mit einem elo ähnlichen System.
Das UI sollte die Möglichkeiten haben die akuellen level und kana statistiken anzuzeigen. Letzteres kannst du ja über eine Kana Tabelle mit Heatmap und KPIs oder ähnlichem machen.
Die User Daten sollten sich auch über das UI zurücksetzen lassen. Aber mit mehrfacher confirmation.


## Tech Stack

 Baue bitte eine einfach eine kleine Angular app die ich dockerisiert ist, sodass ich sie lokal deployen kann. Fortschritte können einfach auf einem volume gespeichert werden. Gerne in einem sqlite file.
 Solltest du ein dediziertes Backend brauchen baue das bitte mit python und benutze uv für die entwicklung. 

 ## Claude.md

Lege eine Claude.md file an in dem du den aktuellen Stand das Projekt pflegst und Infos für Coding Agenten speicherst.