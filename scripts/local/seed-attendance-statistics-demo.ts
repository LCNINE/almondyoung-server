import { Client } from 'pg';

const connectionString = process.env.LOCAL_ATTENDANCE_DEMO_DATABASE_URL;

async function main() {
  if (!connectionString) {
    throw new Error('LOCAL_ATTENDANCE_DEMO_DATABASE_URL을 지정해 주세요.');
  }

  const url = new URL(connectionString);

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/attendance_pwa_test' ||
    url.search ||
    url.hash
  ) {
    throw new Error('이 스크립트는 로컬 attendance_pwa_test DB에서만 실행할 수 있어요.');
  }

  const database = new Client({ connectionString });

  await database.connect();

  try {
    await database.query('BEGIN');

    const role = await database.query("SELECT role_id FROM roles WHERE name = 'admin'");

    if (!role.rows[0]) {
      throw new Error('먼저 로컬 테스트 계정과 역할을 준비해 주세요.');
    }

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    const [year, month, day] = today.split('-').map(Number);
    let records = 0;

    for (let index = 1; index <= 40; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const login = `attendance-demo-${suffix}`;
      const name = `샘플 직원 ${suffix}`;
      const email = `${login}@example.invalid`;
      const user = await database.query(
        `INSERT INTO users (login_id, username, nickname, email)
         VALUES ($1, $2, $2, $3)
         ON CONFLICT (login_id) DO UPDATE SET username = EXCLUDED.username
         WHERE users.email = EXCLUDED.email
         RETURNING id`,
        [login, name, email],
      );
      const userId: string | undefined = user.rows[0]?.id;

      if (!userId) {
        throw new Error(`샘플 계정과 기존 계정이 충돌했어요: ${login}`);
      }

      await database.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING',
        [userId, role.rows[0].role_id],
      );
      await database.query(
        `INSERT INTO attendance_preferences (user_id, settings)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings`,
        [
          userId,
          JSON.stringify({
            normalStart: '09:00',
            normalEnd: '18:00',
            inEnabled: false,
            outEnabled: false,
            inTime: '09:00',
            outTime: '18:00',
            weekdays: [1, 2, 3, 4, 5],
            skipDate: null,
            sound: false,
          }),
        ],
      );

      // Some staff intentionally have no records, so the zero state can be reviewed.
      if (index % 10 === 0) {
        continue;
      }

      for (const offset of [-1, 0]) {
        const first = new Date(Date.UTC(year, month - 1 + offset, 1));
        const lastDay = offset === 0 ? day - 1 : new Date(Date.UTC(year, month + offset, 0)).getUTCDate();
        const targetMonth = first.toISOString().slice(0, 7);
        const days = Math.min(lastDay, 8 + (index % 10));

        for (let workDay = 1; workDay <= days; workDay += 1) {
          const workDate = `${targetMonth}-${String(workDay).padStart(2, '0')}`;
          const checkIn = new Date(`${workDate}T09:${index % 2 ? '10' : '00'}:00+09:00`);
          const checkOut =
            offset === 0 && index % 7 === 0 && workDay === days
              ? null
              : new Date(checkIn.getTime() + (6 + (index % 4)) * 3600000 + (index % 3) * 600000);
          const result = await database.query(
            `INSERT INTO attendance_sessions (user_id, work_date, check_in, check_out)
             VALUES ($1, $2, $3, CASE
               WHEN $4::timestamptz IS NULL AND EXISTS (
                 SELECT 1 FROM attendance_sessions WHERE user_id = $1 AND check_out IS NULL
               ) THEN $3::timestamptz + INTERVAL '8 hours'
               ELSE $4::timestamptz
             END)
             ON CONFLICT (user_id, work_date) DO NOTHING`,
            [userId, workDate, checkIn, checkOut],
          );

          records += result.rowCount ?? 0;
        }
      }
    }

    await database.query('COMMIT');
    console.log(`로컬 샘플 직원 40명 준비 완료, 신규 출퇴근 기록 ${records}건 추가`);
  } catch (error) {
    await database.query('ROLLBACK');

    throw error;
  } finally {
    await database.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
