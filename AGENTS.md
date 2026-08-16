# AGENTS.md

## Ferramentas de busca (já instaladas)

`rg`, `fd`, `tree` e `ast-grep` já estão instalados no ambiente local. Os comandos já funcionam. Use-os no terminal antes de ler arquivos. Não instale, não peça instalação e não substitua por `grep`, `find` ou `ls -R`.

1. Conteúdo: `rg "<padrão>" src` (ou `tests`, `docs`). Exemplo: `rg "getPets|createPet|PetService" src`
2. Arquivos: `fd "pet"` ou `fd "\.test\.js$"`
3. Arquitetura: `tree -L 2 -I 'node_modules|dist|coverage|.git'`
4. Estrutura de código: `ast-grep -p '<padrão>' -l js src`. Procura AST, não texto. Exemplo: `ast-grep -p 'createPet($$$)' -l js src`

Leia um arquivo só depois de localizá-lo com `rg`/`fd`/`ast-grep`. Não abra dezenas de arquivos para descobrir estrutura, rotas, services, repositories, testes ou como um padrão de chamada é usado.
