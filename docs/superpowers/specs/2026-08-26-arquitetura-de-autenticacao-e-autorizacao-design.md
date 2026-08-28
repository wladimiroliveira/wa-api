# Arquitetura de autenticação e autorização

- **Issue:** #34 — Define the system's authentication and authorization architecture
- **Data:** 2026-08-26
- **Status:** aprovado, aguardando plano de implementação

## Problema

A API está aberta. Qualquer um que alcance a porta lê custo, margem e saldo, e
pode alterar tudo isso. O `BearerAuth` declarado no Swagger é decorativo — não
existe verificação alguma por trás dele — e o CORS está em `origin: ["*"]`.

A #36 fechou banco e convenção de tabelas e disse, com todas as letras, que esta
issue dependia daquela decisão. O caminho está livre.

A encarnação anterior do projeto tinha autenticação funcionando (issue #12) e
deixou três dívidas registradas depois de rodar: #18 (refresh token no corpo
força o front a escolher entre sessão que morre no F5 e sessão roubável por
XSS), #19 (não existia nenhuma forma de trocar senha depois de criar o usuário)
e #29 (uma permissão de módulo não bastava para abrir a tela do próprio módulo,
porque a tela lia dados de outro). O modelo aqui foi repensado do zero, mas as
três lições entram como requisito, não como nota de rodapé.

## Restrições

- Uma empresa, poucas pessoas, funções distintas. Todo mundo vê o mesmo dado; o
  que muda é o que cada um pode fazer. Sem multi-empresa, sem coluna de dono nas
  tabelas do domínio.
- O navegador (`wa-web`) é o cliente previsto, mas a API não se fecha nele.
- Node 22 (`lts/jod`), TypeScript ESM, Fastify 5, Zod 4, Prisma 6 sobre
  PostgreSQL 17, conforme o scaffold e a #36.
- Movimentação é append-only (regra 1 da #36). Isso não é detalhe de banco: é o
  que define quais verbos de permissão existem.
- Identificadores em inglês, documentação em português, conforme o CLAUDE.md.

## Decisão 1 — papel opcional mais permissões avulsas, somando

Cada usuário tem **no máximo um papel**, opcional, e **uma lista própria de
permissões avulsas**. A permissão efetiva é a união das duas:

```
efetiva = permissões do papel ∪ extra_permissions do usuário
```

Não existe negação. Para tirar algo de alguém, troca-se o papel ou remove-se a
avulsa — nunca se anota uma exceção negativa. O desenho anterior tinha
`deniedPermissions`, e a própria #12 registrou o preço: a permissão de uma
pessoa deixava de ser óbvia ao olhar o cadastro, a ponto de existir um endpoint
só para responder o que ela realmente podia. Com união pura, ler o cadastro é
ler a resposta.

O papel é o pacote nomeado que evita repetir a mesma lista em cinco pessoas da
mesma função. A avulsa é a diferença individual que não justifica papel novo.
Papel apagado deixa seus usuários sem herança (`onDelete: SetNull`) em vez de
travar a remoção; quem ficou sem papel continua com suas avulsas.

O cálculo vive numa função pura, testada sem banco e sem HTTP, e é a **única**
fonte da resposta. Nenhuma rota refaz essa conta por conta própria.

### Vocabulário de permissões

Permissão é um `enum` do PostgreSQL, não texto livre — a #36 já classificava
"permissão" como conjunto fixado pela lógica do código, que é exatamente o
critério para virar enum. Erro de digitação vira erro de compilação, não porta
aberta.

O nome da permissão descreve **o verbo que a rota de fato oferece**, e não um
`WRITE` genérico. A consequência é uma tabela assimétrica, e a assimetria é a do
próprio domínio: onde o dado é append-only não existe edição para autorizar.

| Módulo                            | Permissões                                         |
| --------------------------------- | -------------------------------------------------- |
| Catálogo — mercadorias e produtos | `CATALOG_READ`, `CATALOG_CREATE`, `CATALOG_UPDATE` |
| Entrada de mercadoria             | `ENTRIES_READ`, `ENTRIES_CREATE`                   |
| Fabricação                        | `PRODUCTION_READ`, `PRODUCTION_CREATE`             |
| Venda                             | `SALES_READ`, `SALES_CREATE`                       |
| Indicadores                       | `REPORTS_READ`                                     |
| Acesso — usuários e papéis        | `ACCESS_READ`, `ACCESS_CREATE`, `ACCESS_UPDATE`    |

Treze permissões, nenhuma sem rota que a exija. As justificativas de cada
ausência:

- **Entrada, fabricação e venda não têm `_UPDATE` nem `_DELETE`.** Movimentação
  não se corrige editando; corrige-se lançando estorno, que é uma criação. Uma
  permissão `ENTRIES_UPDATE` seria atribuível, apareceria na tela do
  administrador e não autorizaria nada — permissão morta engana quem concede.
- **Indicador não tem par de escrita.** É derivado do livro de movimentações,
  nunca gravado direto.
- **Não existe `_DELETE` em lugar nenhum.** Cadastro referenciado por movimento
  não é apagado (regra 4 da #36): desativa-se, e desativar é `CATALOG_UPDATE`.
  Usuário também não é apagado (ver adiante). Apagar um papel é a única remoção
  real do sistema, e cabe em `ACCESS_UPDATE`.
- **Usuário e papel dividem `ACCESS_*`.** O eixo da permissão é a área de
  autoridade — administrar acesso —, não o módulo de código. Separar
  `ROLES_UPDATE` de `USERS_UPDATE` aparentaria contenção sem entregá-la: quem
  administra usuário já pode conceder permissões avulsas a si mesmo.

A lista cresce quando o domínio ganhar módulo. O mecanismo não muda.

### A permissão é lida do banco a cada requisição

O access token carrega apenas o `sub`. Usuário, papel e avulsas são lidos a cada
requisição, e a permissão efetiva é calculada ali. Mudar o acesso de alguém vale
no request seguinte, sem esperar token expirar.

Isso custa um `SELECT` por requisição autenticada. No volume desta operação, é
irrelevante — e é a diferença entre revogação que funciona e revogação que
depende do relógio.

### Desativar em vez de apagar

Usuário tem `is_active`. Desligar corta o acesso no request seguinte e revoga
todos os refresh tokens da pessoa. Não existe `DELETE /v1/users/:id`: o livro de
movimentações precisa continuar explicando quem lançou o quê, e a regra 4 da #36
já proíbe apagar cadastro referenciado por movimento.

### A lição da #29 fica registrada

Permissão por módulo tem um modo de falha conhecido: uma tela que cruza módulos
exige mais de uma permissão, e quem tem só uma delas vê erro onde deveria ver
dado. Foi o que aconteceu com `STOCK_READ` sem `SUPPLIES_READ`.

A escolha aqui é manter a granularidade por módulo e tratar o problema onde ele
nasce, no desenho de cada rota: **uma rota devolve tudo o que a resposta dela
precisa para fazer sentido**, em vez de obrigar o cliente a buscar o
complemento em outro módulo. A rota de movimentações de um insumo devolve o
insumo junto, porque já o leu para responder 404. Nenhum módulo novo é
autorizado a fechar-se dependendo da leitura de outro sem que essa dependência
esteja escrita na tabela de rotas.

## Decisão 2 — JWT curto mais refresh token no banco

Duas credenciais, com papéis distintos: uma prova identidade por poucos minutos,
a outra existe para poder ser revogada.

### Senha

`scrypt` do `node:crypto`. Sem dependência nova e sem binário nativo, e é a
segunda opção do OWASP para armazenamento de senha — atrás apenas do Argon2id e
à frente do bcrypt, que usa cerca de 4 KB de estado e por isso resiste muito
menos a hardware dedicado.

- Salt aleatório de 16 bytes por senha.
- Parâmetros e salt guardados **junto** do digest, no formato
  `scrypt$N$r$p$salt$hash`. Sem isso, subir o custo no futuro invalidaria todos
  os hashes existentes.
- Parâmetros iniciais `N=16384, r=8, p=1`: cerca de 16 MB por verificação, sob o
  `maxmem` padrão de 32 MB do Node.
- Comparação por `timingSafeEqual`.
- Mínimo de 8 caracteres, validado por Zod na borda.

A senha em claro não existe em log, em resposta nem em token.

### Access token

JWT `HS256` assinado com `JWT_SECRET`, vida de 15 minutos, apresentado em
`Authorization: Bearer`. O payload carrega `sub`, `iat` e `exp` — nada mais.
Colocar permissões dentro dele tornaria o frescor da Decisão 1 uma mentira.

### Refresh token

Opaco: 32 bytes aleatórios, vida de 30 dias. O banco guarda **apenas** o hash
SHA-256; vazamento do banco não entrega sessão a ninguém. SHA-256 basta aqui
porque o segredo é aleatório de alta entropia, e não uma senha adivinhável — a
lentidão do scrypt protege contra dicionário, que não é o ataque relevante
contra 32 bytes de aleatoriedade.

Cada `refresh` **rotaciona**: o token apresentado é marcado como revogado e
apontando para o sucessor (`replaced_by_id`), e um par novo é emitido.
Apresentar um token já rotacionado significa que duas partes têm a mesma
credencial, ou seja, roubo: a resposta é revogar a cadeia inteira daquele
usuário e devolver 401. É o que transforma rotação em detecção.

### Transporte: os dois tokens no corpo

Bearer puro. A API serve qualquer cliente — app nativo, integração
server-to-server — e não abre superfície de CSRF.

Consequência aceita, e registrada aqui para não ser redescoberta: é exatamente o
cenário da #18. O SPA guarda o refresh token onde puder, e as duas opções são
ruins de jeitos diferentes — em memória, a sessão morre a cada recarga e os 30
dias viram ficção; em `localStorage`, qualquer XSS no front assume a conta por
30 dias. Migrar o refresh para cookie `httpOnly` continua possível depois, e
arrastaria junto CORS com `credentials`, decisão sobre CSRF e proxy no
desenvolvimento local.

### Trocar senha nasce junto

A #19 mostrou o custo de deixar isso para depois: a senha do Owner vinha de
variável de ambiente, provavelmente compartilhada, e não havia caminho para
trocá-la. Duas rotas, porque são dois casos com regras diferentes:

| Rota                             | Acesso          | Corpo                              | Caso                                  |
| -------------------------------- | --------------- | ---------------------------------- | ------------------------------------- |
| `PATCH /v1/sessions/me/password` | `AUTHENTICATED` | `{ currentPassword, newPassword }` | A pessoa troca a própria senha        |
| `PATCH /v1/users/:id/password`   | `ACCESS_UPDATE` | `{ newPassword }`                  | Administrador reseta a senha de outro |

A senha atual é exigida no primeiro caso e não no segundo — quem administra não
conhece a senha alheia, e o esquecimento é justamente o cenário.

As duas revogam **todos** os refresh tokens do usuário afetado, inclusive o da
sessão que fez a troca. Sem isso, um refresh token roubado sobrevive à troca de
senha e a operação não resolve nada. Deslogar tudo é mais simples de raciocinar
e mais defensável do que preservar a sessão corrente.

### Força bruta

Ponto que a #12 deixou em aberto; fica fechado aqui. `@fastify/rate-limit` em
`POST /v1/sessions/signin` e `PATCH /v1/sessions/me/password`, limitando por IP e por username — só
por IP não segura NAT compartilhado, e só por username permite varrer contas de
um IP só.

Credencial inválida responde sempre a mesma mensagem genérica, tanto para
username inexistente quanto para senha errada, para não revelar quais usernames
existem.

### Bootstrap

`prisma/seed.ts`, exposto como `npm run db:seed`, cria o papel `Owner` com as
treze permissões e o primeiro usuário a partir de `OWNER_USERNAME` e
`OWNER_PASSWORD`. O seed é idempotente: rodar de novo não duplica nem
sobrescreve senha trocada.

Não existe cadastro aberto. Usuário só nasce pela mão de quem tem
`ACCESS_CREATE`.

### Ambiente

Entram no schema Zod de `src/lib/env.ts` e em `.example.env`, com uma exceção anotada abaixo:

| Variável                   | Papel                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| `JWT_SECRET`               | Assinatura do access token; mínimo de 32 caracteres                  |
| `ACCESS_TOKEN_TTL_MINUTES` | Padrão 15                                                            |
| `REFRESH_TOKEN_TTL_DAYS`   | Padrão 30                                                            |
| `CORS_ORIGINS`             | Lista explícita de origens; o `origin: ["*"]` de hoje sai            |
| `OWNER_USERNAME`           | Usuário inicial do seed                                              |
| `OWNER_PASSWORD`           | Senha inicial do seed, trocável por `PATCH /v1/sessions/me/password` |

`OWNER_USERNAME` e `OWNER_PASSWORD` são a exceção: ficam apenas em `.example.env` e são lidas
pelo seed, nunca pelo schema da aplicação. Exigi-las no boot obrigaria todo ambiente a carregar para
sempre a credencial de bootstrap, muito depois de ela ter sido trocada.

Ambiente inválido quebra no import de `env.ts`, como já acontece hoje: um
`JWT_SECRET` ausente não pode ser descoberto no primeiro login.

## Decisão 3 — a exigência é declarada na rota, e o boot cobra

Toda rota declara seu acesso na própria definição, em uma de três formas:

- `PUBLIC` — sem token;
- `AUTHENTICATED` — exige login, nenhuma permissão específica;
- uma `Permission` — exige login e aquela permissão.

Um hook global autentica o portador do token, carrega usuário, papel e avulsas,
calcula a permissão efetiva e a anexa à requisição; a decisão de deixar passar lê
a declaração da própria rota.

O que fecha o modo de falha perigoso é o passo seguinte: um hook `onRoute`
inspeciona **cada rota no momento do registro**, e uma rota sem declaração
**derruba a aplicação no start**, nomeando método e caminho. Não é aviso, não é
teste que reprova depois do commit: é aplicação que não sobe. Rota nova nasce
protegida porque não existe caminho para nascer sem declarar nada.

É a mesma filosofia da Decisão 4 da #36 — convenção documentada e não checada
morre no terceiro módulo. Dois testes acompanham: um garante que o registro de
uma rota sem declaração falha, e outro imprime o inventário rota → acesso como
snapshot legível, de modo que afrouxar uma permissão apareça no diff do PR em
vez de passar despercebido.

Um mapa central de rota para permissão foi descartado: daria a visão completa num
lugar só, mas afastaria a regra da rota e criaria duas coisas para manter em
sincronia — e o snapshot do inventário entrega a mesma visão sem esse custo.

## Decisão 4 — três módulos, com dependência de mão única

| Módulo               | Responsabilidade                                                  |
| -------------------- | ----------------------------------------------------------------- |
| `src/modules/auth/`  | Sessões, senha, tokens, o enum `Permission` e a permissão efetiva |
| `src/modules/users/` | Cadastro de usuário: nome, username, papel, avulsas, `is_active`  |
| `src/modules/roles/` | Catálogo de papéis: nome e pacote de permissões                   |

`roles` não sabe que usuários existem, e `users` não conhece o interior de
`roles`: guarda `role_id` e valida que o papel existe. A consulta que junta
usuário, papel e avulsas — a do hook de autenticação — mora em `auth`, o módulo
dono da pergunta "o que este portador de token pode". É o único lugar onde as
duas entidades se cruzam, e ela existe para responder autenticação, não cadastro.

Dentro de `auth`, o miolo fica em unidades pequenas, testáveis sem banco e sem
HTTP: a função pura da permissão efetiva, o hash e a verificação de senha, e a
emissão e verificação de tokens. Rota não conhece o interior de nenhuma delas.

## Decisão 5 — versão no caminho, e ação nomeada onde o verbo não basta

Acrescentada depois da Fase 1, com a #35 em curso. Duas regras de endereço, uma
para o tempo e outra para a leitura.

### Toda rota vive sob `/v1`

O prefixo entra num lugar só, no registro do módulo de rotas
(`app.register(routes, { prefix: API_PREFIX })`), com `API_PREFIX` numa constante
em `src/lib/api-version.ts`. Nenhuma rota escreve a versão no próprio caminho:
repetir `/v1` em quinze declarações é o conhecimento duplicado que a #36 proibiu,
e bastaria uma esquecida para a API falar duas versões ao mesmo tempo. Um `/v2`
nasce como um segundo módulo de rotas registrado sob outro prefixo, sem tocar em
rota nenhuma do primeiro.

Saúde e documentação entram junto: `/v1/health` e `/v1/docs`. Deixá-las fora
economizaria uma mudança de endereço na monitoração no dia do `/v2`, mas ao preço
de duas regras onde cabe uma — e a regra única é a que ninguém erra ao criar
módulo novo.

O `servers` do OpenAPI continua sem a versão, só com a origem. O `@fastify/swagger`
já coleta os caminhos com o prefixo aplicado, e repetir `/v1` nos dois lugares
montaria `/v1/v1/...` em quem lesse o documento.

### O caminho diz o módulo, e a ação só quando o verbo não a expressa

O primeiro segmento depois da versão é sempre o módulo, no plural. O que vem
depois depende de o verbo HTTP já dizer o que se faz:

- **CRUD segue REST.** `GET /v1/users`, `POST /v1/users`, `PATCH /v1/users/:id`,
  `DELETE /v1/roles/:id`. Nomear a ação aqui seria escrever duas vezes o que o
  método já diz, e cobraria de cache e proxy que adivinhassem a intenção.
- **O que não é CRUD ganha nome.** Entrar e sair não são criação nem remoção de
  recurso: são `POST /v1/sessions/signin` e `POST /v1/sessions/signout`.

`signout` usa `POST`, e não `DELETE`: o refresh token a revogar viaja no corpo, e
`DELETE` com corpo é mal servido por proxy e por cliente HTTP.

Tudo o que é do "eu autenticado" mora sob `/v1/sessions/me` — o cadastro atual em
`GET /v1/sessions/me`, a troca da própria senha em
`PATCH /v1/sessions/me/password`. O reset feito por administrador continua em
`/v1/users/:id/password`, porque é outro caso, com outra permissão e outro corpo.

## Modelo de dados

Sob a convenção da #36: `snake_case` no banco, `camelCase` no TypeScript,
`@map`/`@@map` na fronteira, UUIDv7 com `@db.Uuid`, `timestamptz(3)`, e o enum
com `@@map` em snake_case e valores em `SCREAMING_SNAKE`.

| Tabela           | Colunas                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles`          | `id`, `name` (único), `permissions` (`permission[]`), `created_at`, `updated_at`                                                                              |
| `users`          | `id`, `name`, `username` (único), `password_hash`, `role_id` (nulo, `SetNull`), `extra_permissions` (`permission[]`), `is_active`, `created_at`, `updated_at` |
| `refresh_tokens` | `id`, `user_id` (`Cascade`), `token_hash` (único), `expires_at`, `revoked_at`, `replaced_by_id`, `created_at`                                                 |

As permissões ficam como array de enum na linha do papel e na do usuário. Uma
tabela de junção daria consulta por permissão e integridade referencial por
valor, mas com poucos usuários e um enum fechado seria peça a mais sem cliente.

`refresh_tokens` recebe `@@index([userId], map: "idx_refresh_tokens_user_id")`:
revogar em massa é operação corriqueira aqui — desativação, troca de senha e
detecção de reuso passam todas por ela. `token_hash` usa `@unique` de campo
único, cujo nome padrão do Prisma a #36 já aceita.

## Superfície HTTP

Sob a Decisão 5: todo caminho começa em `/v1`, o segmento seguinte é o módulo, e
a ação só é nomeada onde o verbo HTTP não a expressa.

| Método   | Rota                       | Acesso          | Descrição                                    |
| -------- | -------------------------- | --------------- | -------------------------------------------- |
| `POST`   | `/v1/sessions/signin`      | `PUBLIC`        | Login; devolve o par de tokens               |
| `POST`   | `/v1/sessions/refresh`     | `PUBLIC`        | Rotaciona o par                              |
| `POST`   | `/v1/sessions/signout`     | `AUTHENTICATED` | Logout; revoga o refresh apresentado         |
| `GET`    | `/v1/sessions/me`          | `AUTHENTICATED` | Usuário atual e suas permissões efetivas     |
| `PATCH`  | `/v1/sessions/me/password` | `AUTHENTICATED` | Troca a própria senha                        |
| `GET`    | `/v1/users`                | `ACCESS_READ`   | Lista usuários                               |
| `POST`   | `/v1/users`                | `ACCESS_CREATE` | Cria usuário                                 |
| `GET`    | `/v1/users/:id`            | `ACCESS_READ`   | Cadastro e permissões efetivas já calculadas |
| `PATCH`  | `/v1/users/:id`            | `ACCESS_UPDATE` | Papel, avulsas, nome e `is_active`           |
| `PATCH`  | `/v1/users/:id/password`   | `ACCESS_UPDATE` | Reseta a senha de outro                      |
| `GET`    | `/v1/roles`                | `ACCESS_READ`   | Lista papéis                                 |
| `POST`   | `/v1/roles`                | `ACCESS_CREATE` | Cria papel                                   |
| `PATCH`  | `/v1/roles/:id`            | `ACCESS_UPDATE` | Edita nome e pacote de permissões            |
| `DELETE` | `/v1/roles/:id`            | `ACCESS_UPDATE` | Remove papel; usuários ficam sem herança     |
| `GET`    | `/v1/health`, `/v1/docs`   | `PUBLIC`        | Saúde e documentação                         |

Não existe `GET /v1/users/:id/permissions`: como a fórmula é união pura,
`GET /v1/users/:id` devolve as efetivas junto do cadastro. Não existe
`DELETE /v1/users/:id`, pela Decisão 1.

As rotas do domínio — catálogo, entradas, fabricação, vendas, indicadores —
declaram sua permissão quando forem criadas, nas issues que modelarem o negócio.

## Códigos de resposta

- `401` — token ausente, malformado, com assinatura inválida, expirado, ou de
  usuário desativado ou inexistente. A credencial deixou de valer.
- `403` — autenticado, mas sem a permissão que a rota exige.
- `429` — limite de tentativas atingido em `POST /v1/sessions/signin` ou
  `PATCH /v1/sessions/me/password`.

Mensagem de erro de autenticação não distingue "usuário não existe" de "senha
errada". O formato do corpo de erro é assunto do tratador de erros da API, que
ainda não existe e não entra nesta issue.

## Testes

Sem banco e sem HTTP:

- Permissão efetiva: papel mais avulsas, usuário sem papel, papel apagado,
  permissão presente nos dois lados sem duplicar, usuário sem nada.
- Senha: senha errada reprovada, mesma senha gerando digests diferentes,
  parâmetros lidos do próprio digest, digest de formato inválido rejeitado.
- Tokens: access assinado e verificado, access expirado rejeitado, refresh
  gerado com entropia esperada e guardado apenas como hash.

No boot:

- Registrar uma rota sem declaração de acesso falha, nomeando método e caminho.
- Snapshot do inventário rota → acesso.

Com banco:

- Login com credencial correta e incorreta, com a mesma mensagem nos dois casos
  de falha.
- Rotação do refresh, e reuso de refresh já rotacionado derrubando a cadeia.
- `401` sem token, com token expirado e com usuário desativado.
- `403` com token válido e permissão faltando.
- Desativação e troca de senha revogando as sessões.
- Rate limit disparando no login.

Conforme o CLAUDE.md, cada um desses testes é escrito antes da implementação
correspondente.

## Escopo da issue #34

Esta issue entrega **apenas este documento**. Nenhuma linha de código, nenhuma
tabela, nenhuma dependência instalada.

A #35 recebe o spec e implementa: schema e migration, os três módulos, os hooks,
o seed, as rotas e os testes acima.

## Dependências previstas para a #35

- `@fastify/jwt` — assinatura e verificação do access token.
- `@fastify/rate-limit` — limite de tentativas no login e na troca de senha.

Ambas em `dependencies`, não em `devDependencies`: rodam em produção.

## Riscos e pontos registrados

- **Refresh token no corpo.** O front fica com o dilema da #18. Aceito
  conscientemente em troca de não fechar a API no navegador. Se o `wa-web` for
  o único cliente daqui a alguns meses, migrar para cookie `httpOnly` é uma
  mudança contida em `POST /v1/sessions/signin`,
  `POST /v1/sessions/refresh` e `POST /v1/sessions/signout`.
- **Permissão por módulo cruzando telas.** O modo de falha da #29 não é
  eliminado pelo modelo, e sim mitigado por disciplina de resposta completa em
  cada rota. Cada rota nova do domínio precisa perguntar de quais dados a tela
  dela depende.
- **Sem trilha de auditoria.** Sabe-se quem pode fazer o quê, não quem fez o
  quê. O livro de movimentações registra o autor de cada lançamento, mas
  mudanças de permissão não deixam rastro. Se isso virar requisito, é issue
  própria.
- **`JWT_SECRET` rotacionado invalida todos os access tokens em circulação.**
  Como eles vivem 15 minutos e o refresh continua válido, o efeito prático é um
  pico de refresh, não logout geral. Registrado para não assustar.
- **Custo do scrypt.** 16 MB por verificação de senha. Em login concorrente
  intenso isso pesa; com poucos usuários, não. Se um dia pesar, o parâmetro está
  versionado dentro do digest e pode ser ajustado sem invalidar hash antigo.

## Fora de escopo

Recuperação de senha por e-mail, 2FA, login social, trilha de auditoria de
ações, multi-empresa, e política de senha além do mínimo de 8 caracteres.
