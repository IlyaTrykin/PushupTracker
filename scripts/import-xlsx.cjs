/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function argValue(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}

function toInt(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  return v > 0 ? v : null;
}

function isNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function excelTimeToHM(val, prevTime) {
  if (!val && prevTime) return prevTime;
  if (!val) return null;

  if (val instanceof Date) return { hh: val.getHours(), mm: val.getMinutes(), ss: val.getSeconds() };

  if (isNumber(val)) {
    const totalSeconds = Math.round(val * 24 * 60 * 60);
    const hh = Math.floor(totalSeconds / 3600) % 24;
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    return { hh, mm, ss };
  }

  if (typeof val === 'string') {
    const m = val.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return { hh: Number(m[1]), mm: Number(m[2]), ss: Number(m[3] || 0) };
  }

  return prevTime || null;
}

function normalizeDateCell(val, prevDate) {
  if (!val && prevDate) return prevDate;
  if (!val) return null;

  if (val instanceof Date) return { y: val.getFullYear(), m: val.getMonth() + 1, d: val.getDate() };

  if (typeof val === 'string') {
    const s = val.trim();
    let m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m1) return { y: Number(m1[1]), m: Number(m1[2]), d: Number(m1[3]) };
    let m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m2) return { y: Number(m2[3]), m: Number(m2[2]), d: Number(m2[1]) };
  }
  return prevDate || null;
}

function utcDateOnly(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}
function utcFromLocal(y, m, d, hh, mm, ss, tzOffsetMinutes) {
  const t = Date.UTC(y, m - 1, d, hh, mm, ss || 0, 0);
  return new Date(t - tzOffsetMinutes * 60 * 1000);
}

async function findUserByNameOrMap(sheetName, map) {
  const target = map && map[sheetName] ? map[sheetName] : sheetName;

  const u = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: target, mode: 'insensitive' } },
        { email: { equals: target, mode: 'insensitive' } },
      ],
    },
    select: { id: true, username: true, email: true },
  });
  return u || null;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node import-xlsx.cjs <file.xlsx> [--tz-offset 180] [--map /import/user-map.json]');
    process.exit(1);
  }

  const tzOffsetMinutes = Number(argValue('--tz-offset', '180'));
  const mapPath = argValue('--map', null);

  let map = null;
  if (mapPath) {
    const raw = fs.readFileSync(path.resolve(mapPath), 'utf-8');
    map = JSON.parse(raw);
  }

  const abs = path.resolve(filePath);
  const wb = XLSX.readFile(abs, { cellDates: true });

  let inserted = 0;
  let skipped = 0;

  for (const sheetName of wb.SheetNames) {
    const user = await findUserByNameOrMap(sheetName, map);
    if (!user) {
      console.warn(`SKIP sheet "${sheetName}": user not found`);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!rows || rows.length < 2) continue;

    const header = rows[0].map((x) => (typeof x === 'string' ? x.trim() : x));
    const idxDate = header.indexOf('Дата');
    const idxTime = header.indexOf('Время');
    const idxPush = header.indexOf('Отжимания');
    const idxPull = header.indexOf('Подтягивания');

    if (idxDate === -1 || idxTime === -1 || idxPush === -1 || idxPull === -1) {
      console.warn(`SKIP sheet "${sheetName}": header not recognized`);
      continue;
    }

    let prevDate = null;
    let prevTime = null;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const dateCell = r[idxDate];
      const timeCell = r[idxTime];
      const pushCell = r[idxPush];
      const pullCell = r[idxPull];

      const d = normalizeDateCell(dateCell, prevDate);
      const t = excelTimeToHM(timeCell, prevTime);

      if (d) prevDate = d;
      if (t) prevTime = t;
      if (!prevDate) continue;

      const y = prevDate.y, m = prevDate.m, day = prevDate.d;
      const hh = (prevTime?.hh ?? 12);
      const mm = (prevTime?.mm ?? 0);
      const ss = (prevTime?.ss ?? 0);

      const repsPush = toInt(pushCell);
      const repsPull = toInt(pullCell);
      if (!repsPush && !repsPull) continue;

      const dateOnly = utcDateOnly(y, m, day);
      const timeUtc = utcFromLocal(y, m, day, hh, mm, ss, tzOffsetMinutes);

      async function insertOne(exerciseType, reps) {
        const exists = await prisma.workout.findFirst({
          where: { userId: user.id, exerciseType, time: timeUtc, reps },
          select: { id: true },
        });
        if (exists) { skipped++; return; }
        await prisma.workout.create({ data: { userId: user.id, exerciseType, reps, date: dateOnly, time: timeUtc } });
        inserted++;
      }

      if (repsPush) await insertOne('pushups', repsPush);
      if (repsPull) await insertOne('pullups', repsPull);
    }

    console.log(`OK sheet "${sheetName}" -> user "${user.username || user.email}"`);
  }

  console.log(`DONE: inserted=${inserted}, skipped(duplicates)=${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
