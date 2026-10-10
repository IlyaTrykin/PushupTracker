import { Prisma } from '@prisma/client';

/** The part of the Prisma client registration uses (a fake in tests). */
export type RegisterStore = {
  user: {
    findFirst(args: {
      where: { OR: [{ username: { equals: string; mode: 'insensitive' } }, { email: string }] };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: { email: string; username: string; passwordHash: string; language: string };
    }): Promise<RegisteredUser>;
  };
};

export type RegisteredUser = { id: string; email: string; username: string; language: string };

export type RegisterInput = { email: string; username: string; passwordHash: string; language: string };

/**
 * One outcome for «ник занят» and «email занят» (no account enumeration). The username is
 * unique case-insensitively: the lookup ignores case, and the DB index
 * `User_username_lower_key` turns a concurrent «Demo»/«demo» into P2002 → the same outcome.
 */
export type RegisterOutcome = { ok: true; user: RegisteredUser } | { ok: false; status: 409; code: 'ACCOUNT_TAKEN' };

const ACCOUNT_TAKEN = { ok: false, status: 409, code: 'ACCOUNT_TAKEN' } as const;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function registerAccount(input: RegisterInput, db: RegisterStore): Promise<RegisterOutcome> {
  const taken = await db.user.findFirst({
    where: { OR: [{ username: { equals: input.username, mode: 'insensitive' } }, { email: input.email }] },
    select: { id: true },
  });
  if (taken) return ACCOUNT_TAKEN;

  try {
    const user = await db.user.create({ data: input });
    return { ok: true, user };
  } catch (error) {
    if (isUniqueViolation(error)) return ACCOUNT_TAKEN;
    throw error;
  }
}
