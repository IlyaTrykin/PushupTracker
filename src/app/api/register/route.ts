import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { filterUsersByChannel } from '@/lib/notification-preferences';
import { sendWebPushToUsers } from '@/lib/web-push';
import { sendAdminNewUserRegisteredEmail } from '@/lib/notification-email';

export async function POST(request: Request) {
  try {
    const { email, username, password } = await request.json();

    if (!email || !username || !password) {
      return NextResponse.json({ error: 'Заполните все поля' }, { status: 400 });
    }

    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      return NextResponse.json(
        { error: 'Имя пользователя уже занято. Выберите другое имя.' },
        { status: 409 },
      );
    }

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
      },
    });

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

    return NextResponse.json({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  } catch (e: any) {
    console.error('REGISTER ERROR:', e);

    const message =
      e && typeof e === 'object' && 'message' in e
        ? (e as any).message
        : String(e);

    return NextResponse.json(
      {
        error: 'Внутренняя ошибка сервера',
        details: message,
      },
      { status: 500 },
    );
  }
}
