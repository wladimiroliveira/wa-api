# Camada de Schemas de Resposta — Design

Data: 2026-08-15
Branch base: `feat/username-login`

## Problema

Nenhuma das 33 rotas declara `response` no `schema`. O `@fastify/swagger` já está
configurado e documenta corpo, parâmetros e segurança, mas a resposta de todo
endpoint aparece como `Default Response` sem corpo. Quem consome a API — o
wa-system — não tem contrato: descobre o formato de cada payload chamando e
olhando.

A ausência tem um segundo custo, menos visível. Sem `response`, o
`serializerCompiler` do `fastify-type-provider-zod` não roda, e a resposta é o
que o repositório devolver. Hoje `passwordHash` só fica fora do corpo porque
`users.repository.ts` mantém um `select` explícito; qualquer troca desse `select`
por um `findUnique` cru vaza a credencial sem nada acusar.

## Decisões de desenho

- **A camada documenta e governa.** Declarar `response` liga o serializer do
  Zod: campo não declarado é removido do corpo, campo obrigatório ausente vira
  erro. O contrato deixa de ser descritivo e passa a ser executável.
- **Decimal vira `number`.** Hoje `Prisma.Decimal` é serializado como string
  (`"15.5"`, `"2000"`). Passa a sair como número. A aritmética interna continua
  em `Prisma.Decimal` — só a borda converte.
- **Erro tem schema compartilhado, sem unificação.** O `errorSchema` cobre os
  formatos que já existem; o 400 de validação do Zod continua com o formato do
  Fastify.
- **Schemas de saída moram no `<module>.schema.ts` do próprio módulo**, ao lado
  dos de entrada, seguindo a organização por módulo que o projeto já tem. Só o
  compartilhado ganha arquivo novo.

### Verificação prévia

O comportamento do serializer foi confirmado antes do design, com um app Fastify
mínimo:

| entrada                       | schema              | corpo JSON                   | OpenAPI                       |
| ----------------------------- | ------------------- | ---------------------------- | ----------------------------- |
| `new Prisma.Decimal("15.50")` | `z.coerce.number()` | `15.5`                       | `type: number`                |
| `new Date(...)`               | `z.coerce.date()`   | `"2026-08-15T12:00:00.000Z"` | `string` / `date-time`        |
| campo extra `secret`          | não declarado       | ausente                      | `additionalProperties: false` |

A conversão sai de graça: `Prisma.Decimal.valueOf()` devolve a representação
numérica, então `z.coerce.number()` resolve sem `transform` manual, e o JSON
Schema gerado continua limpo.

## Fundação compartilhada

Arquivo novo `src/modules/shared/response.ts`, ao lado de `money.ts`,
`dimension.ts` e `unit-of-measure.ts`:

```ts
export const decimalSchema = z.coerce.number();
export const timestampSchema = z.coerce.date();

export const errorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  statusCode: z.number().optional(),
  error: z.string().optional(),
});

export const protectedErrors = { 401: errorSchema, 403: errorSchema } as const;
```

`message` é o único campo obrigatório do `errorSchema`. `code` aparece nos erros
de domínio (`DIMENSION_MISMATCH`, `SUPPLY_NOT_FOUND`, `RECIPE_NOT_FOUND`);
`statusCode` e `error` aparecem no 400 que o Fastify gera a partir da validação
do Zod. Um schema só cobre os três formatos, sem `union` poluindo a documentação.
Isso importa porque em `POST /recipes` os dois tipos de 400 dividem o mesmo
status: o de dimensão, montado à mão, e o de validação de corpo.

## Forma das rotas

```ts
r.get(
  "/supplies/:id",
  {
    preHandler: requirePermission(Permission.SUPPLIES_READ),
    schema: {
      params: supplyIdParamSchema,
      response: { 200: supplyResponseSchema, 404: errorSchema, ...protectedErrors },
    },
  },
  handler,
);
```

## Contrato por módulo

| módulo     | rotas | schemas de saída                                                                                 |
| ---------- | ----- | ------------------------------------------------------------------------------------------------ |
| health     | 1     | `healthResponseSchema` — `status` e `database` como enums, servindo 200 e 503                    |
| auth       | 4     | `sessionResponseSchema`, `meResponseSchema`                                                      |
| supplies   | 5     | `supplyResponseSchema` e sua lista                                                               |
| recipes    | 6     | `recipeResponseSchema`, `recipeWithItemsResponseSchema`, `recipeDetailResponseSchema`            |
| pricing    | 1     | `pricingResponseSchema`                                                                          |
| stock      | 2     | `stockMovementResponseSchema`, `stockEntryResponseSchema`                                        |
| waste      | 2     | `wasteResponseSchema`, `stockEntryResponseSchema`                                                |
| production | 3     | `productionResponseSchema`, `productionDetailResponseSchema`, `registerProductionResponseSchema` |
| roles      | 4     | `roleResponseSchema` e sua lista                                                                 |
| users      | 5     | `userResponseSchema`, `userPermissionsResponseSchema`                                            |

Três pontos onde a forma real não é óbvia:

- **`recipes` tem três formas, não uma.** `GET /recipes` devolve a receita sem
  itens; `POST /recipes` e `PATCH /recipes/:id` devolvem com `items` (sem o
  insumo); `GET /recipes/:id` usa `getRecipeWithItems`, que aninha `supply`
  dentro de cada item. São três schemas.
- **`stock` e `waste` compartilham o envelope de criação**:
  `{ movement, currentStock }`. `GET /wastes` é diferente — é o movimento com o
  `supply` aninhado.
- **`POST /productions`** devolve `{ production, consumptions, warnings }`, onde
  `consumptions` é `{ supplyId, consumedBase }[]` e `warnings` é
  `{ supplyId, resultingStock }[]`.

O `userResponseSchema` reproduz os dez `publicFields` do repositório. Ele é a
trava real contra vazamento de `passwordHash`: passa a valer mesmo que o `select`
do repositório mude.

## Status de erro declarados

Cada rota declara só o que produz — nada de espalhar 500 por toda parte.

- `401` nas 30 rotas não públicas; `403` nas 28 delas que exigem permissão
  (`DELETE /sessions` e `GET /me` usam `requireAuth`, sem 403)
- `404` nas 17 rotas com `:id`, mais `POST /productions`, que responde 404 quando
  a receita não existe. Inclui `PATCH` e `DELETE`, onde o 404 vem do
  `errorHandler` traduzindo o `P2025` do Prisma
- `409` em `POST`/`PATCH` de `/users` e `/roles` (P2002) e em
  `GET /recipes/:id/pricing` (`DimensionMismatchError`)
- `400` onde há validação de corpo ou checagem de dimensão
- `429` em `POST /sessions`, que tem rate limit e hoje não está documentado em
  lugar nenhum
- `503` em `GET /health`

As quatro rotas sem corpo — `DELETE /sessions`, `DELETE /supplies/:id`,
`DELETE /recipes/:id`, `DELETE /roles/:id` — declaram `204: z.null()`. O Fastify
não serializa corpo em 204; a declaração existe para o OpenAPI descrever o
status. Se o serializer reclamar do `z.null()` em algum desses casos, a
alternativa é `z.void()`; o teste de OpenAPI decide qual das duas fica.

## Impacto no contrato

Todo campo decimal muda de `string` para `number` no corpo da resposta. É
mudança quebrante para o wa-system. Campos afetados:

- `supplies`: `purchaseQty`, `purchasePrice`, `currentStock`
- `recipes`: `batchYield`, `laborCostPerHundred`, `margin`, `items[].usageQty`
- `stock` e `waste`: `quantityBase`, `currentStock`
- `production`: `factor`, `producedUnits`, `consumptions[].consumedBase`,
  `warnings[].resultingStock`
- `pricing`: os cinco campos, que hoje saem formatados via `toFixed(2)` e
  `toString()`

O `pricing` perde a formatação de duas casas (`12.5` em vez de `"12.50"`) —
formatar é responsabilidade do front. O `exactPrice` deixa de ser exato no
transporte; o cálculo permanece exato em `Prisma.Decimal`.

## Impacto nos testes existentes

Os testes de rota que afirmam decimal como string precisam mudar para número:
`supplies.routes.test.ts` (`"2"`, `"15.5"`, `"9.9"`), `stock.routes.test.ts`
(`"2000"`), e os equivalentes em `waste`, `production`, `recipes` e `pricing`.

## Testes

1. **`tests/docs/openapi.test.ts`** — sobe o app, lê `app.swagger()` e exige que
   toda rota registrada declare schema de resposta para o seu status de sucesso.
   Nasce vermelho listando as 33 rotas e fica verde módulo a módulo. Permanece no
   repositório como guarda-corpo: rota nova sem `response` derruba a suíte.
2. **Teste de vazamento de credencial** — `POST /users` e `GET /users/:id` não
   devolvem `passwordHash`.
3. **Testes de rota atualizados** para os decimais em `number`.

## Documentação

A linha das regras de domínio do README que afirma que `number` nunca é usado
para dinheiro e quantidade passa a valer só para dentro da aplicação: a borda
HTTP converte. O texto é ajustado para dizer isso.

## Fora de escopo

- Unificar o 400 de validação do Zod no formato `{ message, code }`
- Paginação, filtros ou envelopes de coleção
- Exemplos (`examples`) e descrições por campo no OpenAPI
- Versionamento da API
