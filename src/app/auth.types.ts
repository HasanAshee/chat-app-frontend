export interface AuthUser {
  username: string;
  nameColor: string;
  bio?: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface AuthError {
  error: string;
}
