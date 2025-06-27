export interface GlobalConfig {
  database: DatabaseConfig;
  app: AppConfig;
  auth: AuthConfig;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl?: {
    rejectUnauthorized?: boolean;
    ca?: string;
    key?: string;
    cert?: string;
  };
}

export interface AppConfig {
  nodeEnv: string;
  name: string;
  workingDirectory: string;
  url: string;
  corsOrigin: string[];
}

export interface AuthConfig {
  authSecret: string;
  oAuth: {
    google?: {
      clientId: string;
      clientSecret: string;
    };
  };
}
