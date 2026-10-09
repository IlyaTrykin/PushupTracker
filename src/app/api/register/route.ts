import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { normalizeLocale } from '@/i18n/locale';
import { setPreferredLocaleCookie } from '@/i18n/server';
import { filterUsersByChannel } from '@/lib/notification-preferences';
import { sendWebPushToUsers } from '@/lib/web-push';
import { sendAdminNewUserRegisteredEmail } from '@/lib/notification-email';
import { normalizeEmail, validateNewPassword, validateNewUsername } from '@/lib/account-validation';
import { authRateLimitRules, authText, checkRateLimits, requestLocale, validationErrorText } from '@/lib/auth';
import { clientIp, tooManyRequests } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const locale = requestLocale(request);
  const text = authText(locale);
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: text.invalidJson }, { status: 400 });
    }
    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const rawUsername = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const language = normalizeLocale(body.language);

    if (!rawEmail.trim() || !rawUsername.trim() || !password) {
      return NextResponse.json({ error: text.fillAllFields }, { status: 400 });
    }

    const limit = await checkRateLimits(authRateLimitRules.register(clientIp(request)));
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, locale);

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return NextResponse.json({ error: text.invalidEmail, code: 'EMAIL_INVALID' }, { status: 400 });
    }

    const usernameCheck = validateNewUsername(rawUsername);
    if (!usernameCheck.ok) {
      return NextResponse.json(
        { error: validationErrorText(locale, usernameCheck.code), code: usernameCheck.code },
        { status: 400 },
      );
    }
    const username = usernameCheck.value;

    const passwordCheck = validateNewPassword(password);
    if (!passwordCheck.ok) {
      return NextResponse.json(
        { error: validationErrorText(locale, passwordCheck.code), code: passwordCheck.code },
        { status: 400 },
      );
    }

    // Ник уникален без учёта регистра; занятость ника и email — один общий ответ.
    const taken = await prisma.user.findFirst({
      where: {
        OR: [{ username: { equals: username, mode: 'insensitive' } }, { email }],
      },
      select: { id: true },
    });
    const accountTaken = () =>
      NextResponse.json({ error: text.accountTaken, code: 'ACCOUNT_TAKEN' }, { status: 409 });
    if (taken) return accountTaken();

    const passwordHash = await bcrypt.hash(password, 10);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          language,
        },
      });
    } catch (createError) {
      if (createError instanceof Prisma.PrismaClientKnownRequestError && createError.code === 'P2002') {
        return accountTaken();
      }
      throw createError;
    }

    // Админам отправляем in-app/push/email о новой регистрации (ошибки не ломают регистрацию).
    try {
      const admins = await prisma.user.findMany({
        where: { isAdmin: true, deletedAt: null },
        select: { id: true, username: true, email: true },
      });

      if (admins.length) {
        const adminIds = admins.map((a) => a.id);
        const title = 'Новая регистрация пользователя';
        const body = `${user.username} (${user.email})`;
        const link = '/admin/users';
        const adminIdsForPush = await filterUsersByChannel(adminIds, 'admin_new_user_registered', 'push');
        const adminIdsForEmail = await filterUsersByChannel(adminIds, 'admin_new_user_registered', 'email');
        const adminIdsForInApp = Array.from(new Set([...adminIdsForPush, ...adminIdsForEmail]));

        if (adminIdsForInApp.length) {
          await prisma.notification.createMany({
            data: adminIdsForInApp.map((adminId) => ({
              userId: adminId,
              type: 'admin_new_user_registered',
              title,
              body,
              link,
            })),
          });
        }

        if (adminIdsForPush.length) {
          await sendWebPushToUsers(adminIdsForPush, {
            title,
            body,
            link,
            tag: `admin-register-${user.id}`,
          }).catch((pushError) => {
            console.error('REGISTER ADMIN PUSH ERROR:', pushError);
          });
        }

        for (const admin of admins) {
          if (!admin.email) continue;
          if (!adminIdsForEmail.includes(admin.id)) continue;
          await sendAdminNewUserRegisteredEmail({
            to: admin.email,
            adminUsername: admin.username,
            newUsername: user.username,
            newEmail: user.email,
            request,
          }).catch((mailError) => {
            console.error('REGISTER ADMIN EMAIL ERROR:', mailError);
          });
        }
      }
    } catch (notifyError) {
      console.error('REGISTER ADMIN NOTIFY ERROR:', notifyError);
    }

    const res = NextResponse.json({
      id: user.id,
      email: user.email,
      username: user.username,
      language: user.language,
    });
    setPreferredLocaleCookie(res, language, request);
    return res;
  } catch (e: unknown) {
    console.error('REGISTER ERROR:', e);
    return NextResponse.json({ error: text.internal }, { status: 500 });
  }
}
