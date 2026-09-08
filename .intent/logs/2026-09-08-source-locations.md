# Preserve source locations

The user requested opening Chat file references at their indicated line and optional column. Discovery previously removed those suffixes before opening and lost the position. The public file-location helper now projects path and textSelection separately. Both existence resolution and native fallback keep the canonical plain path, while viewer consumers may use the structured position. Links retains no viewer dependency.

The user requested fast implementation without tests or worktrees. The package was built through its owned script against the selected Host; no browser behavior was automated.
