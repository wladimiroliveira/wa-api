# Banco de dados e padrão de tabelas

- **Issue:** #36 — Define the database and the system's table standard
- **Data:** 2026-08-22
- **Status:** aprovado, aguardando plano de implementação

## Problema

O repositório está no scaffold, sem banco. As issues #34 e #35 (arquitetura e
implementação de autenticação) dependem de uma decisão que ainda não foi tomada:
qual banco, sob qual ORM, e com qual convenção de nomes.

A encarnação anterior do projeto usava PostgreSQL 17 com Prisma, mas com dois
defeitos que este documento corrige:

1. Os modelos não tinham `@map`/`@@map`, então o Postgres recebeu identificadores
   em camelCase. Toda consulta SQL manual precisava de aspas duplas
   (`"purchaseUnit"`), e esquecer as aspas dava erro só em tempo de execução.
2. Os campos `Decimal` não declaravam precisão, e o Prisma os materializou como
   `numeric(65,30)` — trinta casas decimais em toda coluna de dinheiro.

O domínio atual é novo. O dado que cresce sem parar é um livro de movimentações —
entrada de mercadoria, fabricação de produto e venda de produto — que alimenta
indicadores e análises.

## Restrições

- Volume estimado: até ~50 mil movimentações por mês, somando os três tipos.
  Cerca de 600 mil linhas por ano, ~3 milhões em cinco anos.
- Retenção longa: o histórico não é descartado, porque é a base dos indicadores.
- Node 22 (`lts/jod`), TypeScript ESM, Fastify 5, Zod 4, conforme o scaffold.
- Nomes de tabelas, colunas e identificadores em inglês, conforme o CLAUDE.md.

## Decisão 1 — PostgreSQL 17 com Prisma

O banco é **PostgreSQL 17** (`postgres:17-alpine`), acessado via **Prisma 6**.
Local por `docker compose`, com healthcheck e volume nomeado.

O dado é essencialmente contábil: valores exatos, relações rígidas, agregações
por período. O Postgres entrega `numeric` de precisão arbitrária, `timestamptz`
nativo, enums, índices parciais e compostos, CTEs e funções de janela para os
indicadores, e particionamento declarativo disponível caso o volume um dia mude
de ordem de grandeza. Nem MySQL nem um banco de documentos oferecem vantagem
aqui.

O Prisma foi escolhido por continuidade — já rodou neste repositório — e porque
entrega migrations versionadas e cliente tipado desde a primeira tabela. Sua
fraqueza conhecida é agregação complexa; os indicadores sairão por `$queryRaw`
com o resultado validado por Zod, o que é adequado no volume estimado.

Um único banco atende OLTP e leitura analítica. Separar as duas cargas neste
volume seria complexidade sem cliente.

## Decisão 2 — padrão de nomenclatura

A regra de ouro: **o banco fala snake_case, o TypeScript fala camelCase, e o
`@map` é a fronteira entre os dois.** Nenhum SQL manual precisa de aspas duplas,
e nenhum objeto TypeScript foge do estilo da linguagem.

| Elemento            | Padrão                                            | Exemplo                                            |
| ------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Tabela              | `snake_case`, plural, inglês                      | `stock_movements`, `sale_items`                    |
| Coluna              | `snake_case`, singular                            | `quantity_base`, `created_at`                      |
| Modelo Prisma       | `PascalCase` singular + `@@map`                   | `model StockMovement { @@map("stock_movements") }` |
| Campo Prisma        | `camelCase` + `@map`                              | `quantityBase Decimal @map("quantity_base")`       |
| Chave primária      | sempre `id`                                       | `id`                                               |
| Chave estrangeira   | `<tabela_referenciada_singular>_id`               | `supply_id`, `sale_id`                             |
| Booleano            | prefixo `is_` ou `has_`                           | `is_active`                                        |
| Data e hora         | sufixo `_at`, sempre `timestamptz`                | `created_at`, `revoked_at`                         |
| Tipo enum           | `snake_case` singular, valores `SCREAMING_SNAKE`  | `stock_movement_type` → `ENTRY`, `SALE`            |
| Índice              | `map: "idx_<tabela>_<colunas>"`, sempre explícito | `idx_stock_movements_supply_id_created_at`         |
| `@@unique` composto | `map: "uq_<tabela>_<colunas>"`, sempre explícito  | `uq_stock_movements_supply_id_quantity_base`       |
| PK, FK, unique      | nome padrão do Prisma, sem `map:`                 |
| Check               | `ck_<tabela>_<regra>`, escrita à mão na migration | `ck_sale_items_quantity_positive`                  |

O índice é o único que exige `map:` explícito, e a razão é concreta: o nome que o
Prisma gera sozinho para um índice composto estoura o limite de 63 caracteres do
Postgres e é truncado em silêncio. Um `@@index([stockMovementId, originalSupplyId, createdAt, id])`
vira `stock_movement_reversals_stock_movement_id_original_supply__idx` — as duas
últimas colunas somem do nome, e dois índices distintos da mesma tabela podem
colidir. PK, FK e unique não têm esse problema: os nomes padrão do Prisma
(`<tabela>_pkey`, `<tabela>_<coluna>_fkey`, `<tabela>_<coluna>_key`) são curtos,
determinísticos e já são a convenção do próprio Postgres. Renomeá-los custaria
`map:` em toda relação sem resolver problema nenhum.

O `@@unique` de bloco é a exceção dentro da exceção, e a razão é a mesma do
índice: o Postgres materializa a constraint como um índice, cujo nome automático
é montado pelo mesmo mecanismo e truncado no mesmo limite de 63 caracteres. Um
`@@unique([a, b, c])` de colunas longas colide igual. Já o `@unique` de campo
único gera `<tabela>_<coluna>_key`, que é curto — esse fica com o padrão do
Prisma.

### Tipos canônicos

Esta tabela é a fonte única. Uma coluna nova escolhe uma linha daqui; se nenhuma
serve, a tabela ganha uma linha nova — não se inventa tipo caso a caso.

| Natureza do dado           | Tipo                                                   |
| -------------------------- | ------------------------------------------------------ |
| Quantidade, custo unitário | `numeric(18,6)`                                        |
| Valor monetário total      | `numeric(18,2)`                                        |
| Percentual, margem         | `numeric(9,6)` (`0.185000` = 18,5%)                    |
| Data e hora                | `timestamptz(3)`, em UTC                               |
| Texto livre                | `text` (limite via Zod na borda, não via `varchar(n)`) |
| Identificador              | `uuid`, UUIDv7 — exige `@db.Uuid`                      |

A chave primária é **UUIDv7** (`@default(uuid(7)) @db.Uuid`). Diferente do UUIDv4,
ele é ordenável no tempo, então inserções caem no fim do índice em vez de
fragmentá-lo, e o desempate por `id` na paginação por cursor é coerente com a
ordem cronológica. Diferente de um `bigint` sequencial, não expõe volume de
registros na API.

O `@db.Uuid` não é opcional. Sem ele, o Prisma materializa a coluna como `TEXT`
em vez de `UUID` — 36 bytes de texto por chave em vez de 16 bytes binários, em
toda PK e toda FK. Foi o que aconteceu no schema anterior, e é a razão de o teste
de convenção precisar cobrir isso.

### Enum do Postgres ou tabela de apoio

- Conjunto fixado pela lógica do código — tipo de movimento, permissão — vira
  **enum do Postgres**.
- Conjunto que o usuário administra — motivo de perda, categoria — vira
  **tabela de apoio**.

Remover um valor de enum no Postgres exige recriar o tipo. Essa distinção evita
que uma mudança de cadastro vire migration de emergência.

## Decisão 3 — regras estruturais do dado histórico

Cinco regras de modelagem. Nenhuma exige infraestrutura extra; todas evitam
reescrita depois.

1. **Movimentação é append-only.** Sem `UPDATE` e sem `DELETE` nas tabelas de
   movimento. Correção é lançamento de estorno. Preserva a auditoria e é o que
   torna o particionamento por tempo viável no futuro sem mexer em regra de
   negócio.
2. **Preço e custo são snapshot.** Toda linha de movimento grava o valor vigente
   no instante do lançamento; nunca aponta para o preço atual do cadastro. Sem
   isso, reprecificar um insumo reescreveria anos de indicador.
3. **Paginação por cursor, nunca `OFFSET`.** Toda tabela histórica nasce com
   índice composto `(<coluna de filtro>, created_at DESC, id DESC)`, de modo que
   uma página seja leitura de faixa em vez de ordenação da tabela inteira.
4. **Cadastro referenciado por movimento não é apagado.** `onDelete: Restrict`
   mais `is_active`. Um insumo desativado continua explicando o histórico.
5. **UTC no banco, fuso na borda.** `timestamptz` gravado em UTC; conversão
   apenas na apresentação.

### O que fica de fora, e por quê

Nada de tabela de agregado diário, materialized view ou particionamento agora.
Com 3 milhões de linhas em cinco anos, uma soma apoiada em índice responde em
milissegundos; construir agregado hoje é complexidade sem cliente.

O que preserva o caminho de crescimento é isolamento: as consultas de indicador
vivem num módulo de leitura próprio, separado dos repositórios de escrita. Trocar
"agrega na hora" por "lê agregado" passa a ser mudança de um módulo só.

Ressalva registrada: se o volume um dia exigir particionamento por faixa de
`created_at`, a chave primária precisará incluir a coluna de partição — o
Postgres exige isso em toda PK e unique de tabela particionada — o que
significaria recriar a tabela. É um custo real, aceito conscientemente, porque o
volume informado torna esse cenário improvável.

## Decisão 4 — a convenção é verificada, não confiada

Convenção documentada e não checada morre no terceiro módulo. A convenção vira
teste automatizado, escrito antes da implementação, conforme o TDD do CLAUDE.md.

O teste lê `prisma/schema.prisma` e falha quando:

- um `model` não tem `@@map`, ou o valor do `@@map` não é snake_case plural;
- um campo escalar não tem `@map`, ou o valor não é snake_case;
- um campo de tipo `String` usado como `@id` ou como FK não declara `@db.Uuid`;
- um campo `Decimal` não declara `@db.Decimal(p,s)`;
- um campo `DateTime` não declara `@db.Timestamptz(3)`;
- um campo escalar de relação não termina em `_id` no nome mapeado;
- um campo `Boolean` não começa com `is` ou `has`;
- um campo `DateTime` não termina em `At`;
- um `@@index` não declara `map:` começando com `idx_`;
- um `@@unique` de bloco não declara `map:` começando com `uq_`.

## Escopo da issue #36

Entregue por esta issue:

- `docker-compose.yml` com PostgreSQL 17, healthcheck e volume nomeado.
- Prisma inicializado: `prisma/schema.prisma`, datasource, generator, e as
  variáveis correspondentes em `.example.env`.
- O teste de convenção descrito na Decisão 4.
- Este documento como referência da convenção.

Fora do escopo: modelar as tabelas do domínio. A #36 define o padrão; as issues
seguintes modelam o negócio sobre ele.

## Riscos e pontos a confirmar na implementação

- `@default(uuid(7))` foi verificado no Prisma 6.19.3 com `prisma validate` e
  `prisma migrate diff`: é aceito e gera `UUID` no Postgres quando acompanhado de
  `@db.Uuid`. Risco fechado.
- O teste de convenção lê o schema como texto. Se o formato do
  `prisma/schema.prisma` mudar entre versões, o teste precisa acompanhar. Em
  troca, ele não depende de banco no ar nem de cliente gerado.
- O Prisma não modela check constraints. As da convenção `ck_` são escritas à mão
  dentro da migration gerada, e o teste de convenção não as cobre.
