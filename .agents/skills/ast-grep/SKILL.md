---
name: ast-grep
description: Search JavaScript by AST structure with the local ast-grep CLI. Use when locating call sites, require/module.exports, Express routes, or code patterns more precisely than text search with rg.
---

# ast-grep

`ast-grep` already works locally. Do not install it. Prefer it over `rg` when the query is a code pattern, not a word. This backend is CommonJS JavaScript (`-l js`), not TypeScript.

## Commands

```bash
ast-grep -p '<padrão>' -l js src
ast-grep -p '<padrão>' -l js tests
```

- `$A` matches one AST node
- `$$$` matches zero or more nodes (arguments, statements)

## Examples

```bash
ast-grep -p 'createPet($$$)' -l js src
ast-grep -p 'await $OBJ.$METHOD($$$)' -l js src
ast-grep -p 'router.$METHOD($PATH, $$$)' -l js src
ast-grep -p 'module.exports = $X' -l js src
```

Read a file only after `ast-grep` (or `rg`/`fd`) points to it. Do not open many files to discover how a pattern is used.
