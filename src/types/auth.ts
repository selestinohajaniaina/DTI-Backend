export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/** User fields that are safe to expose through the API (never includes passwordHash). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

declare global {
  // Global Request augmentation is the documented Express pattern for typed
  // auth context; it cannot be expressed with an ES module declaration.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
