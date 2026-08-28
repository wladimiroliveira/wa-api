import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Cost lives in the digest rather than in a constant, so raising it later does not invalidate every
// password already stored. N=16384 with r=8 costs about 16 MB per verification, under Node's 32 MB
// default for maxmem.
const ALGORITHM = "scrypt";
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function encode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

// Promisified by hand rather than with `promisify`: the helper resolves to the three-argument
// overload of `scrypt`, which leaves no room for the cost parameters.
function derive(plain: string, salt: Buffer, cost: number, blockSize: number, parallelism: number): Promise<Buffer> {
  const options = { N: cost, r: blockSize, p: parallelism, maxmem: 128 * cost * blockSize * 2 };

  return new Promise((resolve, reject) => {
    scrypt(plain, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(plain, salt, COST, BLOCK_SIZE, PARALLELISM);

  return [ALGORITHM, COST, BLOCK_SIZE, PARALLELISM, encode(salt), encode(key)].join("$");
}

export async function verifyPassword(plain: string, digest: string): Promise<boolean> {
  const parts = digest.split("$");

  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;

  const [, cost, blockSize, parallelism, salt, expected] = parts;
  const expectedKey = Buffer.from(expected, "base64url");

  const key = await derive(plain, Buffer.from(salt, "base64url"), Number(cost), Number(blockSize), Number(parallelism));

  if (key.length !== expectedKey.length) return false;

  return timingSafeEqual(key, expectedKey);
}
