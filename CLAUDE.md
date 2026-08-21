## Arquivos proibidos de leitura

Nunca leia, mostre ou referencie os seguintes arquivos:

- .env\* (variáveis de ambiente)
- _credentials_, _.pem, _.key
- ~/.npmrc (tokens npm)
- ~/.ssh/\* (chaves SSH)
- ~/.aws/_, ~/.gcp/_, ~/.azure/\*

Se o usuário pedir explicitamente para ler, avise antes.

# Regras universais de desenvolvimento

Valem em todos os projetos. Um CLAUDE.md de projeto pode acrescentar, nunca afrouxar.

## Idioma

- Fale comigo em português.
- Código em inglês, sempre: identificadores, arquivos, testes, comentários, scripts.
- Português só no que o usuário lê na tela — textos de interface do front-end.
- Commits, PRs e nomes de branch em inglês. No PR, tudo: título, títulos de
  seção e corpo. Nenhuma linha em português, nem os itens da descrição.

## Git

- Não commite, não dê push, não abra PR sem ordem explícita. Trabalho terminado
  fica na árvore, sujo, esperando você decidir.
- Nunca trabalhe na main. Branch antes: `feat|fix|chore|docs|refactor/kebab-name`.
- Não toque em outro repositório sem permissão explícita.
- Integração é por PR. O merge na main é seu.

## Commits e PRs

- Commit: `type(scope): what the change does`. Uma linha, direta. Sem corpo,
  a não ser que você peça.
- Diga o que a mudança faz, não como faz. Detalhe técnico fica no diff.
- Título e corpo do PR em inglês, sempre — inclusive os títulos de seção,
  exatamente como estão abaixo. Ver não-negociável em "Idioma".
- PR: só duas seções, nesta ordem e com estes títulos:

  ```
  ## What changed
  - item — what it is for

  ## Dependencies
  - package@version — reason   (or "none")
  ```

- Um item por mudança, uma linha cada, no máximo 10 itens. Passou disso, o PR
  está grande demais: divida.
- Sem introdução, sem conclusão, sem enfeite. Nada de "Summary", "Test plan",
  "Motivation", "Context", "How to test", checklist ou emoji.
- Template do repositório não vale: se `.github/pull_request_template.md` existir,
  ignore as seções dele e use o formato acima.

## Design de código

- Ortogonalidade: cada módulo cuida de uma responsabilidade e não conhece o
  interior dos outros. Mudança em um não pode obrigar mudança em cascata.
- DRY: um comportamento vive num lugar só. Repetiu regra, constante ou consulta,
  extraia — não copie e cole.

## Testes

- TDD, sem exceção: teste que falha primeiro, para feature e para bug.
- Cole a saída do teste vermelho antes de escrever a implementação.
- Bug sem teste que o reproduza não está consertado.

## Antes de dizer "pronto"

- Rode a verificação dirigida ao que você mexeu — teste, typecheck, lint daquele
  alvo — e cole a saída.
- Portão completo do projeto só quando pedido.
- Sem saída de comando, nenhuma afirmação de sucesso. "Deve passar" não existe.
- Se algo ficou de fora ou falhou, diga na hora, com a saída.

## Escopo

- Entregue o pedido inteiro. Nem menos, nem mais.
- Não refatore o que não foi pedido. Achou problema fora do escopo: relate,
  não conserte.
- Dúvida que muda o resultado: pergunte. Dúvida que não muda: decida e diga o
  que decidiu.
