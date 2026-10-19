import { DefaultSession } from "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      codename?: string | null;
      roles?: string[];
    } & DefaultSession["user"];
    // No provider tokens here: the session is served to the browser. Server
    // code gets the GitHub token from `getSessionWithGitHubToken`.
    /** Set to "RefreshAccessTokenError" when the token refresh failed. */
    error?: string | null;
  }
  interface User {
    codename?: string | null;
    roles?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    codename?: string | null;
    roles?: string[];
    error?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string | null;
    refreshToken?: string | null;
    accessTokenExpires?: number;
    userId?: string;
    codename?: string | null;
    error?: string | null;
  }
}
