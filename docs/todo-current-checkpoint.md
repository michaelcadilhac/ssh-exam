# Current checkpoint — redundant --all REMOVED AND TESTED LOCALLY

November12 follow-up: remove parser flag/state/compatibility conditions; migrate
help, both zsh examples and operating docs. Default full listings, explicit limits,
filters, signed scope checks and authority are unchanged. --all/--all=false are
refused before configuration/authentication for ordinary and formatted commands.

Verification: focused actual CLI/TLS checks, full CLI race suite32.86s, static
build/vet/types and both zsh syntax checks pass. Exact candidate real gateway plus
second-go workflow and synthetic bwrap grading:8passes/12unselected,13.89s.
Evidence:var/collection-tests/remove-all.20261112/; docs/complete-cli-lists.md.
CLI candidate SHA2565927a0703f76578836bc553e12c3b3d466928623261725b5e0821c382d8abfce.
No web/native-authority changes; their existing qualification still applies.

Local work complete; no push/deployment requested for this follow-up. Before a
future CLI deployment, migrate installed example invocations too; custom scripts
must omit the removed flag. New scripts work with the currently deployed CLI.
Production remains CLI47bda3d (accepts --all), webed09efc/schema37; prior CLI
rollout/preservation evidence is in docs/complete-cli-lists.md.

Separate pending work: grading-helper repair cb58259 is pushed but uninstalled;
saved-work idle task:null diagnostic remains in TODO. Original ten dirty images
preserved; all16documentation image hashes match the prior baseline.
