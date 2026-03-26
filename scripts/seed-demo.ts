import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { createTrainingProgram } from '../src/lib/program';

type DemoUserSpec = {
  username: string;
  email: string;
  password: string;
  language: string;
  isAdmin?: boolean;
  weightKg: number;
  gender: string;
  birthDate: Date;
};

type CreatedUsers = Record<string, Awaited<ReturnType<typeof ensureUser>>>;

const DEMO_USER_SPECS: DemoUserSpec[] = [
  {
    username: 'demo',
    email: 'demo@demo.local',
    password: 'demo123',
    language: 'ru',
    weightKg: 78,
    gender: 'male',
    birthDate: new Date('1993-05-19T00:00:00.000Z'),
  },
  {
    username: 'admin',
    email: 'admin@demo.local',
    password: 'admin123',
    language: 'ru',
    isAdmin: true,
    weightKg: 82,
    gender: 'male',
    birthDate: new Date('1990-03-14T00:00:00.000Z'),
  },
  {
    username: 'lena',
    email: 'lena@demo.local',
    password: 'demo123',
    language: 'ru',
    weightKg: 59,
    gender: 'female',
    birthDate: new Date('1996-11-02T00:00:00.000Z'),
  },
  {
    username: 'max',
    email: 'max@demo.local',
    password: 'demo123',
    language: 'en',
    weightKg: 88,
    gender: 'male',
    birthDate: new Date('1991-07-08T00:00:00.000Z'),
  },
  {
    username: 'coach',
    email: 'coach@demo.local',
    password: 'demo123',
    language: 'ru',
    weightKg: 84,
    gender: 'male',
    birthDate: new Date('1988-01-21T00:00:00.000Z'),
  },
  {
    username: 'rita',
    email: 'rita@demo.local',
    password: 'demo123',
    language: 'ru',
    weightKg: 63,
    gender: 'female',
    birthDate: new Date('1998-09-12T00:00:00.000Z'),
  },
];

function daysAgo(days: number, hour = 19, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

function daysFromNow(days: number, hour = 19, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

async function cleanupPreviousDemoData() {
  const demoUsers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@demo.local' } },
        { username: { in: DEMO_USER_SPECS.map((user) => user.username) } },
      ],
    },
    select: { id: true },
  });

  const demoUserIds = demoUsers.map((user) => user.id);

  if (demoUserIds.length) {
    await prisma.challenge.deleteMany({
      where: {
        creatorId: { in: demoUserIds },
      },
    });
  }

  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { endsWith: '@demo.local' } },
        { username: { in: DEMO_USER_SPECS.map((user) => user.username) } },
      ],
    },
  });
}

async function ensureUser(spec: DemoUserSpec) {
  const passwordHash = await bcrypt.hash(spec.password, 10);
  return prisma.user.create({
    data: {
      email: spec.email,
      username: spec.username,
      passwordHash,
      language: spec.language,
      isAdmin: Boolean(spec.isAdmin),
      weightKg: spec.weightKg,
      gender: spec.gender,
      birthDate: spec.birthDate,
      pushFriendRequest: true,
      pushChallengeInvite: true,
      pushChallengeRankChange: true,
    },
    select: {
      id: true,
      username: true,
      email: true,
      isAdmin: true,
    },
  });
}

async function seedUsers(): Promise<CreatedUsers> {
  const users = await Promise.all(DEMO_USER_SPECS.map(ensureUser));
  return Object.fromEntries(users.map((user) => [user.username, user])) as CreatedUsers;
}

async function seedRewards() {
  const rewards = [
    { minPointsTenths: 50, message: 'Мягкий старт' },
    { minPointsTenths: 120, message: 'Хороший темп' },
    { minPointsTenths: 200, message: 'Жаркая тренировка' },
    { minPointsTenths: 350, message: 'Монстр подхода' },
  ];

  for (const reward of rewards) {
    await prisma.workoutReward.upsert({
      where: { minPointsTenths: reward.minPointsTenths },
      update: { message: reward.message },
      create: reward,
    });
  }
}

async function seedFriendships(users: CreatedUsers) {
  await prisma.friendship.createMany({
    data: [
      { userId: users.demo.id, friendId: users.lena.id, status: 'accepted', createdAt: daysAgo(40, 11, 15) },
      { userId: users.max.id, friendId: users.demo.id, status: 'accepted', createdAt: daysAgo(28, 12, 0) },
      { userId: users.coach.id, friendId: users.demo.id, status: 'pending', createdAt: daysAgo(1, 9, 20) },
      { userId: users.demo.id, friendId: users.rita.id, status: 'pending', createdAt: daysAgo(2, 18, 10) },
    ],
  });

  await prisma.friendFollow.createMany({
    data: [
      { followerId: users.demo.id, friendId: users.lena.id },
      { followerId: users.demo.id, friendId: users.max.id },
      { followerId: users.lena.id, friendId: users.demo.id },
      { followerId: users.max.id, friendId: users.demo.id },
    ],
  });
}

async function createWorkout(userId: string, exerciseType: string, reps: number, time: Date) {
  return prisma.workout.create({
    data: {
      userId,
      exerciseType,
      reps,
      date: time,
      time,
    },
    select: { id: true, userId: true, exerciseType: true, reps: true, time: true },
  });
}

async function seedWorkouts(users: CreatedUsers) {
  const demoWorkoutInputs = [
    ['pushups', 42, daysAgo(0, 7, 45)],
    ['pushups', 36, daysAgo(1, 20, 10)],
    ['plank', 95, daysAgo(2, 7, 10)],
    ['squats', 64, daysAgo(3, 18, 30)],
    ['pushups', 44, daysAgo(4, 7, 55)],
    ['pullups', 11, daysAgo(6, 19, 0)],
    ['pushups', 38, daysAgo(7, 8, 10)],
    ['crunches', 72, daysAgo(8, 18, 20)],
    ['pushups', 40, daysAgo(10, 7, 30)],
    ['plank', 110, daysAgo(12, 21, 5)],
    ['squats', 70, daysAgo(13, 17, 50)],
    ['pushups', 34, daysAgo(15, 7, 20)],
    ['pullups', 9, daysAgo(17, 18, 45)],
    ['pushups', 37, daysAgo(20, 7, 40)],
    ['crunches', 84, daysAgo(22, 20, 30)],
    ['pushups', 31, daysAgo(24, 6, 55)],
    ['plank', 80, daysAgo(27, 21, 15)],
    ['squats', 58, daysAgo(30, 18, 0)],
    ['pushups', 29, daysAgo(34, 7, 5)],
    ['pushups', 33, daysAgo(39, 20, 40)],
  ] as const;

  const lenaWorkoutInputs = [
    ['pushups', 25, daysAgo(0, 6, 50)],
    ['plank', 70, daysAgo(2, 21, 0)],
    ['crunches', 90, daysAgo(5, 19, 15)],
    ['pushups', 27, daysAgo(9, 7, 5)],
    ['squats', 52, daysAgo(14, 18, 10)],
    ['pushups', 24, daysAgo(18, 7, 35)],
    ['plank', 85, daysAgo(23, 20, 0)],
  ] as const;

  const maxWorkoutInputs = [
    ['pullups', 14, daysAgo(1, 19, 10)],
    ['pushups', 46, daysAgo(4, 8, 0)],
    ['squats', 75, daysAgo(7, 18, 0)],
    ['plank', 120, daysAgo(11, 21, 20)],
    ['pushups', 43, daysAgo(16, 7, 30)],
    ['pullups', 12, daysAgo(21, 19, 0)],
    ['pushups', 39, daysAgo(29, 8, 20)],
  ] as const;

  const coachWorkoutInputs = [
    ['pushups', 55, daysAgo(3, 6, 45)],
    ['pullups', 16, daysAgo(8, 19, 0)],
    ['plank', 130, daysAgo(13, 20, 40)],
    ['squats', 82, daysAgo(19, 18, 25)],
    ['pushups', 50, daysAgo(26, 7, 15)],
  ] as const;

  const demoWorkouts = [];
  for (const [exerciseType, reps, time] of demoWorkoutInputs) {
    demoWorkouts.push(await createWorkout(users.demo.id, exerciseType, reps, time));
  }

  for (const [exerciseType, reps, time] of lenaWorkoutInputs) {
    await createWorkout(users.lena.id, exerciseType, reps, time);
  }

  for (const [exerciseType, reps, time] of maxWorkoutInputs) {
    await createWorkout(users.max.id, exerciseType, reps, time);
  }

  for (const [exerciseType, reps, time] of coachWorkoutInputs) {
    await createWorkout(users.coach.id, exerciseType, reps, time);
  }

  await prisma.workoutReaction.createMany({
    data: [
      { workoutId: demoWorkouts[0].id, userId: users.lena.id, emoji: '🔥' },
      { workoutId: demoWorkouts[0].id, userId: users.max.id, emoji: '👍' },
      { workoutId: demoWorkouts[1].id, userId: users.lena.id, emoji: '👍' },
      { workoutId: demoWorkouts[2].id, userId: users.max.id, emoji: '🔥' },
      { workoutId: demoWorkouts[4].id, userId: users.coach.id, emoji: '👍' },
    ],
  });
}

async function seedChallenges(users: CreatedUsers) {
  const activeChallenge = await prisma.challenge.create({
    data: {
      creatorId: users.demo.id,
      name: 'Мартовский рывок',
      exerciseType: 'pushups',
      mode: 'most',
      startDate: daysAgo(3, 0, 0),
      endDate: daysFromNow(10, 0, 0),
      participants: {
        create: [
          { userId: users.demo.id, status: 'accepted' },
          { userId: users.lena.id, status: 'accepted' },
          { userId: users.max.id, status: 'pending' },
        ],
      },
    },
    select: { id: true },
  });

  const inviteChallenge = await prisma.challenge.create({
    data: {
      creatorId: users.lena.id,
      name: 'Планка без паники',
      exerciseType: 'plank',
      mode: 'target',
      targetReps: 300,
      startDate: daysFromNow(1, 0, 0),
      endDate: daysFromNow(14, 0, 0),
      participants: {
        create: [
          { userId: users.lena.id, status: 'accepted' },
          { userId: users.demo.id, status: 'pending' },
        ],
      },
    },
    select: { id: true },
  });

  await prisma.challenge.create({
    data: {
      creatorId: users.coach.id,
      name: 'Февральский спринт',
      exerciseType: 'squats',
      mode: 'target',
      targetReps: 400,
      startDate: daysAgo(35, 0, 0),
      endDate: daysAgo(7, 0, 0),
      participants: {
        create: [
          { userId: users.coach.id, status: 'accepted' },
          { userId: users.demo.id, status: 'accepted' },
          { userId: users.lena.id, status: 'accepted' },
        ],
      },
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: users.max.id,
        type: 'challenge_invite',
        title: 'Приглашение в соревнование',
        body: 'demo пригласил вас в соревнование: Мартовский рывок',
        link: `/challenges/${activeChallenge.id}`,
      },
      {
        userId: users.demo.id,
        type: 'challenge_invite',
        title: 'Приглашение в соревнование',
        body: 'lena пригласила вас в соревнование: Планка без паники',
        link: `/challenges/${inviteChallenge.id}`,
      },
    ],
  });
}

async function seedNotifications(users: CreatedUsers) {
  await prisma.notification.createMany({
    data: [
      {
        userId: users.demo.id,
        type: 'friend_request',
        title: 'Новый запрос в друзья',
        body: 'coach отправил вам запрос в друзья',
        link: '/friends',
      },
      {
        userId: users.demo.id,
        type: 'friend_workout',
        title: 'Новая тренировка друга',
        body: 'max завершил сильную тренировку по подтягиваниям',
        link: '/friends',
      },
      {
        userId: users.demo.id,
        type: 'challenge_rank_change',
        title: 'Изменение позиции в соревновании',
        body: 'Мартовский рывок: 2 → 1 (поднялись)',
        link: '/challenges',
      },
    ],
  });
}

async function markProgramHistory(programId: string, exerciseType: string) {
  const sessions = await prisma.trainingSession.findMany({
    where: { programId },
    include: { sets: true },
    orderBy: [{ weekNumber: 'asc' }, { sessionNumber: 'asc' }],
  });

  for (const session of sessions) {
    const completedAt = new Date(session.scheduledAt.getTime() + 50 * 60 * 1000);
    await prisma.trainingSession.update({
      where: { id: session.id },
      data: {
        startedAt: new Date(session.scheduledAt.getTime() + 5 * 60 * 1000),
        completed: true,
        completedAt,
      },
    });

    for (const set of session.sets) {
      const actualReps = exerciseType === 'plank'
        ? Math.max(20, set.targetReps)
        : Math.max(1, set.targetReps + (set.setNumber === 5 ? 2 : 0));

      await prisma.trainingSet.update({
        where: { id: set.id },
        data: {
          actualReps,
          completedAt,
        },
      });
    }
  }

  await prisma.trainingProgram.update({
    where: { id: programId },
    data: {
      isActive: false,
      status: 'completed',
    },
  });
}

async function markProgramActivePartial(programId: string, exerciseType: string) {
  const sessions = await prisma.trainingSession.findMany({
    where: { programId },
    include: { sets: true },
    orderBy: [{ weekNumber: 'asc' }, { sessionNumber: 'asc' }],
    take: 1,
  });

  for (const session of sessions) {
    const completedAt = new Date(session.scheduledAt.getTime() + 45 * 60 * 1000);
    await prisma.trainingSession.update({
      where: { id: session.id },
      data: {
        startedAt: new Date(session.scheduledAt.getTime() + 8 * 60 * 1000),
        completed: true,
        completedAt,
      },
    });

    for (const set of session.sets) {
      const actualReps = exerciseType === 'plank'
        ? set.targetReps
        : Math.max(1, set.targetReps + (set.isKeySet ? 1 : 0));

      await prisma.trainingSet.update({
        where: { id: set.id },
        data: {
          actualReps,
          completedAt,
        },
      });
    }
  }
}

async function seedPrograms(users: CreatedUsers) {
  const activeProgram = await createTrainingProgram(users.demo.id, {
    exerciseType: 'pushups',
    baselineMaxReps: 28,
    targetReps: 50,
    durationWeeks: 8,
    frequencyPerWeek: 3,
    ageYears: 31,
    weightKg: 78,
    sex: 'male',
    startDate: daysAgo(6, 0, 0),
  });

  const historyProgram = await createTrainingProgram(users.demo.id, {
    exerciseType: 'plank',
    baselineMaxReps: 70,
    targetReps: 180,
    durationWeeks: 4,
    frequencyPerWeek: 2,
    ageYears: 31,
    weightKg: 78,
    sex: 'male',
    startDate: daysAgo(50, 0, 0),
  });

  if (activeProgram?.id) {
    await markProgramActivePartial(activeProgram.id, 'pushups');
  }

  if (historyProgram?.id) {
    await markProgramHistory(historyProgram.id, 'plank');
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  await cleanupPreviousDemoData();
  const users = await seedUsers();
  await seedRewards();
  await seedFriendships(users);
  await seedWorkouts(users);
  await seedChallenges(users);
  await seedNotifications(users);
  await seedPrograms(users);

  console.log(JSON.stringify({
    ok: true,
    users: DEMO_USER_SPECS.map((user) => ({
      username: user.username,
      password: user.password,
      role: user.isAdmin ? 'admin' : 'user',
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
