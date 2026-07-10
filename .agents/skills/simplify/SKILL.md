---
name: simplify
description: Use this skill automatically when you feel your code ready for human review. This means the code works and achieves a stated goal, verified by your own tests and/or, if you deem it necessary, human testing.
---

Review changes in the current branch, or in the state the user specifies. Apply these criteria without changing behavior:

1. **Names**: Shorten verbose names while keeping them clear. Prefer human-readable concepts (`baseline`) over compound phrases that are more mechanical / academic (`lastObservedDiskContent`).

2. **Combine related concepts**: If two types, functions, or constants overlap significantly, merge them. The fewer distinct concepts a reader must hold in their head, the better. *Example: two union types sharing 3 of 4 values → one type with shorter value names.*

3. **Derivability**: If a value can be computed from other values already in scope, don't pass or store it separately. Removing derivable state often simplifies signatures, types, and control flow in one move. *Example: an `isDirty` parameter that's always derived from computing `editorContent !== baseline` can be dropped.*

4. **Scope**: Only touch code in the staged diff. Run existing tests after every change.
