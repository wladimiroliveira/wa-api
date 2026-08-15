-- 1. coluna nula primeiro, para poder preencher as linhas que já existem
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- 2. deriva do trecho antes do @ do email, mantendo só os caracteres permitidos
UPDATE "User"
SET "username" = lower(regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9._-]', '', 'g'));

-- 3. e-mail exótico pode não sobrar nada: cai para um valor derivado do id
UPDATE "User"
SET "username" = 'user-' || left("id", 8)
WHERE "username" IS NULL OR "username" = '';

-- 4. desempata colisões acrescentando um sufixo estável
WITH duplicated AS (
  SELECT "id",
         "username",
         row_number() OVER (PARTITION BY "username" ORDER BY "createdAt", "id") AS position
  FROM "User"
)
UPDATE "User" AS u
SET "username" = d."username" || '-' || left(u."id", 8)
FROM duplicated AS d
WHERE u."id" = d."id" AND d.position > 1;

-- 5. só agora a coluna pode ser obrigatória e única
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
