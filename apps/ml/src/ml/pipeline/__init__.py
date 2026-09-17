"""Pipeline de separation et d'analyse.

Le decoupage suit une regle : les fonctions de traitement sont pures et ne font
aucune entree/sortie reseau. Seuls `io_audio` et `runner` touchent au disque ou aux
processus externes, ce qui rend l'essentiel de la logique testable sans audio reel.
"""
