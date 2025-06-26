import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { organization, twoFactor, bearer, admin } from 'better-auth/plugins';

console.log('process.env.DATABASE_URL:"', process.env.DATABASE_URL);
export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  plugins: [admin(), bearer()],
  emailAndPassword: {
    enabled: true,
  },
  session: {
    freshAge: 10,
    modelName: 'sessions',
    cookie: {
      name: 'auth',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
    },
  },
  user: {
    modelName: 'users',
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'user',
      },
    },
  },
  account: {
    modelName: 'accounts',
  },
  verification: {
    modelName: 'verifications',
  },
  socialProviders: {
    // google: {
    //   clientId: process.env.GOOGLE_CLIENT_ID,
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // },
  },
});
