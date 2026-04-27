import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, tap, catchError, throwError, of } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthUser, AuthResponse } from './auth.types';

const TOKEN_KEY = 'chat_auth_token';

@Injectable({ providedIn: 'root' })
export class AuthService {

  private readonly _currentUser = signal<AuthUser | null>(null);
  readonly currentUser = this._currentUser.asReadonly();
  readonly isLoggedIn = computed(() => this._currentUser() !== null);

  constructor(private http: HttpClient) {
    const token = this.getToken();
    if (token) {
      this.fetchMe().subscribe({
        next: (user) => this._currentUser.set(user),
        error: () => {
          this.clearToken();
          this._currentUser.set(null);
        }
      });
    }
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  private setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  private clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  private authHeaders(): HttpHeaders {
    const token = this.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  register(username: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(
      `${environment.apiUrl}/auth/register`,
      { username, password }
    ).pipe(
      tap(res => {
        this.setToken(res.token);
        this._currentUser.set(res.user);
      })
    );
  }

  login(username: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(
      `${environment.apiUrl}/auth/login`,
      { username, password }
    ).pipe(
      tap(res => {
        this.setToken(res.token);
        this._currentUser.set(res.user);
      })
    );
  }

  logout(): void {
    this.clearToken();
    this._currentUser.set(null);
  }

  fetchMe(): Observable<AuthUser> {
    return this.http.get<AuthUser>(
      `${environment.apiUrl}/auth/me`,
      { headers: this.authHeaders() }
    );
  }

  updateColor(nameColor: string): Observable<AuthUser> {
    return this.http.patch<AuthUser>(
      `${environment.apiUrl}/users/me`,
      { nameColor },
      { headers: this.authHeaders() }
    ).pipe(
      tap(user => this._currentUser.set(user))
    );
  }

  updateBio(bio: string): Observable<AuthUser> {
    return this.http.patch<AuthUser>(
      `${environment.apiUrl}/users/me`,
      { bio },
      { headers: this.authHeaders() }
    ).pipe(
      tap(user => this._currentUser.set(user))
    );
  }

  getErrorMessage(err: any): string {
    if (err?.error?.error) return err.error.error;
    if (err?.message) return err.message;
    return 'Error desconocido';
  }
}
