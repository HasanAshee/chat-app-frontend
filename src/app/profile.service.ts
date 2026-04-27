import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

export interface UserProfile {
  username: string;
  nameColor: string;
  bio: string;
  memberSince: string;
  messageCount: number;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  constructor(private http: HttpClient) {}

  getProfile(username: string): Observable<UserProfile> {
    return this.http.get<UserProfile>(
      `${environment.apiUrl}/users/${encodeURIComponent(username)}/profile`
    );
  }
}
