import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';

export interface ConversationSummary {
  _id: string;
  otherUsername: string;
  otherNameColor: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageFrom: string;
  unreadCount: number;
}

export interface DmMessage {
  _id: string;
  conversationId: string;
  from: string;
  fromColor: string;
  text: string;
  createdAt: string | Date;
  reactions?: { [emoji: string]: string[] };
  replyTo?: string | null;
  replyToSnapshot?: {
    username: string;
    nameColor: string;
    text: string;
  } | null;
  deletedForEveryone?: boolean;
}

export interface OpenDm {
  conversationId: string;
  otherUsername: string;
  otherNameColor: string;
  expanded: boolean;
  messages: DmMessage[];
  loadedHistory: boolean;
  typingUser: string | null;
}

@Injectable({ providedIn: 'root' })
export class DmService {

  private readonly _conversations = signal<ConversationSummary[]>([]);
  readonly conversations = this._conversations.asReadonly();

  private readonly _openDms = signal<OpenDm[]>([]);
  readonly openDms = this._openDms.asReadonly();

  readonly totalUnread = computed(() =>
    this._conversations().reduce((sum, c) => sum + (c.unreadCount || 0), 0)
  );

  constructor(private http: HttpClient, private auth: AuthService) {}

  private authHeaders(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  loadConversations(): Observable<ConversationSummary[]> {
    return this.http.get<ConversationSummary[]>(
      `${environment.apiUrl}/dms`,
      { headers: this.authHeaders() }
    ).pipe(
      tap(list => this._conversations.set(list))
    );
  }

  openConversation(withUsername: string): Observable<ConversationSummary> {
    return this.http.post<ConversationSummary>(
      `${environment.apiUrl}/dms/open`,
      { withUsername },
      { headers: this.authHeaders() }
    ).pipe(
      tap(conv => {
        const existing = this._conversations();
        if (!existing.find(c => c._id === conv._id)) {
          this._conversations.set([conv, ...existing]);
        }
      })
    );
  }

  loadMessages(conversationId: string): Observable<DmMessage[]> {
    return this.http.get<DmMessage[]>(
      `${environment.apiUrl}/dms/${conversationId}/messages`,
      { headers: this.authHeaders() }
    );
  }

  markAsRead(conversationId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${environment.apiUrl}/dms/${conversationId}/read`,
      {},
      { headers: this.authHeaders() }
    ).pipe(
      tap(() => {
        const list = this._conversations().map(c =>
          c._id === conversationId ? { ...c, unreadCount: 0 } : c
        );
        this._conversations.set(list);
      })
    );
  }


  openDmFromConversation(conv: ConversationSummary): void {
    const open = this._openDms();
    const existing = open.find(d => d.conversationId === conv._id);

    if (existing) {
      this._openDms.set(open.map(d =>
        d.conversationId === conv._id ? { ...d, expanded: true } : d
      ));
      return;
    }

    const trimmed = open.length >= 3 ? open.slice(0, -1) : open;

    const newDm: OpenDm = {
      conversationId: conv._id,
      otherUsername: conv.otherUsername,
      otherNameColor: conv.otherNameColor,
      expanded: true,
      messages: [],
      loadedHistory: false,
      typingUser: null
    };

    this._openDms.set([newDm, ...trimmed]);
  }

  toggleDmExpand(conversationId: string): void {
    this._openDms.set(this._openDms().map(d =>
      d.conversationId === conversationId ? { ...d, expanded: !d.expanded } : d
    ));
  }

  closeDm(conversationId: string): void {
    this._openDms.set(this._openDms().filter(d => d.conversationId !== conversationId));
  }

  setMessagesForDm(conversationId: string, messages: DmMessage[]): void {
    this._openDms.set(this._openDms().map(d =>
      d.conversationId === conversationId
        ? { ...d, messages, loadedHistory: true }
        : d
    ));
  }

  appendMessage(message: DmMessage): void {
    const myUsername = this.auth.currentUser()?.username;
    const open = this._openDms();
    const isOpenAndExpanded = open.some(
      d => d.conversationId === message.conversationId && d.expanded
    );

    this._conversations.set(
      this._conversations().map(c => {
        if (c._id !== message.conversationId) return c;
        const isFromMe = message.from === myUsername;
        const incrementUnread = !isFromMe && !isOpenAndExpanded;
        return {
          ...c,
          lastMessageAt: typeof message.createdAt === 'string' ? message.createdAt : message.createdAt.toISOString(),
          lastMessagePreview: (message.text || '').slice(0, 80),
          lastMessageFrom: message.from,
          unreadCount: incrementUnread ? c.unreadCount + 1 : c.unreadCount
        };
      }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    );

    if (open.find(d => d.conversationId === message.conversationId)) {
      this._openDms.set(open.map(d =>
        d.conversationId === message.conversationId
          ? { ...d, messages: [...d.messages, message] }
          : d
      ));
    }
  }

  setTypingForDm(conversationId: string, fromUsername: string | null): void {
    this._openDms.set(this._openDms().map(d =>
      d.conversationId === conversationId ? { ...d, typingUser: fromUsername } : d
    ));
  }

  reset(): void {
    this._conversations.set([]);
    this._openDms.set([]);
  }

  removeMessageFromDm(conversationId: string, messageId: string): void {
    this._openDms.set(this._openDms().map(d => {
      if (d.conversationId !== conversationId) return d;
      return { ...d, messages: d.messages.filter(m => m._id !== messageId) };
    }));
  }

  markDmMessageAsDeleted(conversationId: string, messageId: string): void {
    this._openDms.set(this._openDms().map(d => {
      if (d.conversationId !== conversationId) return d;
      return {
        ...d,
        messages: d.messages.map(m =>
          m._id === messageId
            ? { ...m, deletedForEveryone: true, text: '', reactions: {} }
            : m
        )
      };
    }));
}

}
