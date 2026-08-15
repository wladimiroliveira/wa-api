# Autenticação e Autorização por Permissões de Módulo — Design

**Issue:** https://github.com/wladimiroliveira/wa-api/issues/12

## Problema

A API está aberta. Qualquer um que alcance a porta lê o custo dos insumos, a
margem de cada receita e o saldo de estoque, e pode alterar tudo isso. O
`BearerAuth` declarado no Swagger (`src/server.ts`) é decorativo — não há
`preHandler` nem verificação por trás dele — e o CORS está em `origin: ["*"]`.

Auditoria da issue confirmou, por inspeção do código, que as 20 rotas de domínio
são anônimas e que a tabela de rotas da issue corresponde exatamente às rotas
declaradas em `src/modules/**/*.routes.ts`.

## Decisões de desenho

| Questão              | Decisão                                            | Consequência                                                              |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| Quem faz login       | Uma empresa, poucos usuários com contas separadas  | Nenhuma tabela do domínio ganha coluna de dono                            |
| Modelo de acesso     | Permissão por módulo, separando leitura de escrita | 13 permissões                                                             |
| Atribuição           | Papéis nomeados **mais** exceções por usuário      | Exige que a permissão efetiva seja calculável e inspecionável             |
| Sessão               | JWT de vida curta + refresh token no banco         | Logout e revogação funcionam de verdade                                   |
| Frescor da permissão | Lida do banco a cada requisição                    | Mudança de permissão vale no request seguinte; o token carrega só o `sub` |

### Decisões fechadas na auditoria (2026-08-15)

Os quatro pontos que a issue deixou em aberto:

1. **`POST /productions`** exige apenas `PRODUCTION_WRITE`. Registrar produção
   pressupõe o consumo de insumo; exigir também `STOCK_WRITE` esvaziaria a
   separação, já que todo mundo que produz precisaria das duas.
2. **CORS** deixa de ser `["*"]` e passa a vir de `CORS_ORIGINS`, lista separada
   por vírgula, obrigatória na inicialização.
3. **Limite de tentativas no login** entra agora, via `@fastify/rate-limit`,
   escopado em `POST /sessions`.
4. **Vida útil dos tokens:** access de 15 minutos, refresh de 30 dias, ambos
   configuráveis por variável de ambiente.

### Fatiamento

A entrega vai em três pull requests, para respeitar o limite de dez itens por PR:

1. **Fundação** — schema Prisma, permissão efetiva, hash de senha. Só unitário,
   nenhuma rota muda de comportamento.
2. **Sessões e aplicação** — login, refresh, logout, `preHandler` global,
   `requirePermission` nas 20 rotas existentes, CORS e rate limit.
3. **Administração** — `/me`, `/users`, `/roles` e o seed do primeiro usuário.

## Permissões

Enum do Prisma, não texto livre — pelo mesmo motivo que `UnitOfMeasure` é enum:
erro de digitação vira erro de compilação, não porta aberta.

```prisma
enum Permission {
  SUPPLIES_READ    SUPPLIES_WRITE
  RECIPES_READ     RECIPES_WRITE
  PRICING_READ
  STOCK_READ       STOCK_WRITE
  PRODUCTION_READ  PRODUCTION_WRITE
  WASTE_READ       WASTE_WRITE
  USERS_READ       USERS_WRITE
}
```

`PRICING_READ` não tem par de escrita: preço é derivado de insumo, receita e
margem, nunca gravado direto. `USERS_*` protege a própria administração de acesso.

### Permissão efetiva

```
efetiva = (papel ∪ grantedPermissions) − deniedPermissions
```

Negação ganha sempre. A conta vive numa função pura em `auth.permissions.ts`,
testada isoladamente, e é a única fonte da resposta — nenhuma rota refaz esse
cálculo por conta própria. `GET /users/:id/permissions` expõe o resultado para
que a permissão de alguém não precise ser deduzida de cabeça.

### Desativar em vez de apagar

`isActive` desliga o acesso preservando o histórico de produção e avaria que a
pessoa lançou. Desativar corta no request seguinte e revoga os refresh tokens.

## Sessão

- Senha com `scrypt` do `node:crypto` — sem dependência nova, sem binário nativo.
- Access token JWT assinado com `JWT_SECRET`, carregando apenas `sub`.
- `RefreshToken` guarda apenas o SHA-256 do token opaco. O token é 32 bytes
  aleatórios, então não precisa de KDF lento: não há dicionário a atacar.
- Rotação marca o token antigo como substituído (`replacedById`). Apresentar um
  token já rotacionado revoga toda a sessão do usuário — é sinal de roubo.

## Superfície HTTP

### Rotas públicas

`GET /health`, `/docs`, `POST /sessions`, `POST /sessions/refresh`.

### Default-deny

Um hook `onRequest` global autentica: verifica a assinatura do access token,
carrega usuário, papel e exceções, calcula a permissão efetiva e a anexa à
requisição. Cada rota declara o que exige via `requirePermission(Permission.X)`
ou `requireAuth()`; rota pública declara `config: { public: true }`.

Um hook `onRoute` recusa a inicialização se alguma rota não declarar nenhum dos
dois. É o que impede que uma rota nova nasça aberta por esquecimento — a
exigência continua greppável na própria rota, sem mapa central.

`401` para ausência de token, token inválido, expirado ou usuário desativado.
`403` para autenticado sem a permissão exigida.

### Rotas novas

| Método   | Rota                     | Permissão     |
| -------- | ------------------------ | ------------- |
| `POST`   | `/sessions`              | pública       |
| `POST`   | `/sessions/refresh`      | pública       |
| `DELETE` | `/sessions`              | autenticado   |
| `GET`    | `/me`                    | autenticado   |
| `GET`    | `/users`                 | `USERS_READ`  |
| `POST`   | `/users`                 | `USERS_WRITE` |
| `GET`    | `/users/:id`             | `USERS_READ`  |
| `PATCH`  | `/users/:id`             | `USERS_WRITE` |
| `GET`    | `/users/:id/permissions` | `USERS_READ`  |
| `GET`    | `/roles`                 | `USERS_READ`  |
| `POST`   | `/roles`                 | `USERS_WRITE` |
| `PATCH`  | `/roles/:id`             | `USERS_WRITE` |
| `DELETE` | `/roles/:id`             | `USERS_WRITE` |

Não há `DELETE /users/:id` — desativação é o caminho, pelo histórico.

### Rotas existentes

| Rota                                                                                      | Permissão          |
| ----------------------------------------------------------------------------------------- | ------------------ |
| `GET /supplies`, `GET /supplies/:id`                                                      | `SUPPLIES_READ`    |
| `POST /supplies`, `PATCH /supplies/:id`, `DELETE /supplies/:id`                           | `SUPPLIES_WRITE`   |
| `GET /recipes`, `GET /recipes/:id`                                                        | `RECIPES_READ`     |
| `POST /recipes`, `PATCH /recipes/:id`, `PATCH /recipes/:id/margin`, `DELETE /recipes/:id` | `RECIPES_WRITE`    |
| `GET /recipes/:id/pricing`                                                                | `PRICING_READ`     |
| `GET /supplies/:id/movements`                                                             | `STOCK_READ`       |
| `POST /supplies/:id/stock-entries`                                                        | `STOCK_WRITE`      |
| `GET /wastes`                                                                             | `WASTE_READ`       |
| `POST /supplies/:id/wastes`                                                               | `WASTE_WRITE`      |
| `GET /productions`, `GET /productions/:id`                                                | `PRODUCTION_READ`  |
| `POST /productions`                                                                       | `PRODUCTION_WRITE` |

## Bootstrap

`prisma/seed.ts`, exposto como `npm run db:seed`, cria o papel `Owner` com as 13
permissões e o primeiro usuário a partir de `OWNER_EMAIL` e `OWNER_PASSWORD`.
Não existe cadastro aberto: usuário só nasce pela mão de quem tem `USERS_WRITE`.

## Variáveis de ambiente

| Variável                 | Obrigatória | Padrão | Uso                                          |
| ------------------------ | ----------- | ------ | -------------------------------------------- |
| `JWT_SECRET`             | sim         | —      | Assinatura do access token, mínimo 32 chars  |
| `CORS_ORIGINS`           | sim         | —      | Lista de origens separada por vírgula        |
| `ACCESS_TOKEN_TTL`       | não         | `15m`  | Vida do access token                         |
| `REFRESH_TOKEN_TTL_DAYS` | não         | `30`   | Vida do refresh token, em dias               |
| `LOGIN_RATE_LIMIT_MAX`   | não         | `5`    | Tentativas de login por endereço, por 15 min |
| `OWNER_EMAIL`            | só no seed  | —      | Primeiro usuário                             |
| `OWNER_PASSWORD`         | só no seed  | —      | Senha do primeiro usuário                    |

## Dependências novas

- `@fastify/jwt` — assinatura e verificação do access token.
- `@fastify/rate-limit` — limite de tentativas no login.

Ambas em `dependencies`: `tests/package/runtime-dependencies.test.ts` reprova se
ficarem em `devDependencies`.

## Impacto nos testes existentes

Os seis arquivos de teste de integração de domínio
(`tests/modules/{supplies,recipes,pricing,stock,waste,production}`) chamam
`app.inject` sem token e passariam a receber `401`. Todos ganham cabeçalho de
autenticação vindo de um helper compartilhado. `health` continua público.

## Testes

- **Unitários, sem banco:** permissão efetiva (herança, soma, subtração,
  precedência da negação, usuário sem papel), hash e verificação de senha,
  leitura da configuração de ambiente.
- **Integração:** login com credencial correta e incorreta, rotação do refresh,
  reuso de refresh já rotacionado, token expirado, `401` sem token, `403` com
  token válido e permissão faltando, usuário desativado perdendo acesso, rota
  pública seguindo aberta, e a recusa de inicialização quando uma rota não
  declara exigência.

## Fora de escopo

Recuperação de senha por email, 2FA, login social, trilha de auditoria de ações
e multi-empresa.
