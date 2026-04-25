export interface AuthUser {
  username: string;
  nameColor: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface AuthError {
  error: string;
}
