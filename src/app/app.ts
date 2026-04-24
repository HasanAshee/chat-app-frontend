import { Component, OnInit, ChangeDetectorRef, Renderer2, Inject, DOCUMENT, ViewChild, ElementRef, AfterViewChecked, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Socket } from 'ngx-socket-io';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';



interface Message {
  _id?: string;
  text: string;
  username?: string;
  type: 'message' | 'notification';
  createdAt?: Date;
  reactions?: { [emoji: string]: string[] };
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSlideToggleModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit, AfterViewChecked, OnDestroy  {

  @ViewChild('messageListContainer') private messageListContainer!: ElementRef;

  newMessage = '';
  messages: Message[] = [];
  username = '';
  room = '';
  isLoggedIn = false;
  typingUser = '';
  usersInRoom: string[] = [];
  private typingTimeout: any;
  activeRooms: { name: string; userCount: number }[] = [];
  private roomsInterval: any;

  mentionMatches: string[] = [];
  showMentionPopup = false;
  selectedMentionIndex = 0;
  private mentionStartPos = -1;

  private unreadMentions = 0;
  private originalTitle = '';
  private notificationSound!: HTMLAudioElement;

  availableEmojis = ['👍', '❤️', '🤪​', '🦧​', '👻​', '❓​'];
  showEmojiPickerForMessage: string | null = null;

  private shouldScroll = false;

  isDarkMode = false;

  constructor(
    private socket: Socket,
    private cdr: ChangeDetectorRef,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    private http: HttpClient
  ) {}

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  private colorPalette = ['#d946ef', '#4ade80', '#f97316', '#3b82f6', '#ec4899', '#14b8a6'];

  getUsernameColor(username: string): string {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % this.colorPalette.length);
    return this.colorPalette[index];
  }

  toggleDarkMode(): void {
    this.isDarkMode = !this.isDarkMode;
    const hostClass = this.isDarkMode ? 'dark-mode' : '';
    this.renderer.setAttribute(this.document.body, 'class', hostClass);
    localStorage.setItem('darkMode', this.isDarkMode ? 'true' : 'false');
  }

  ngOnInit(): void {

    this.originalTitle = this.document.title;

    this.notificationSound = new Audio('/assets/notification.mp3');
    this.notificationSound.volume = 0.4;

    this.document.addEventListener('visibilitychange', () => {
      if (!this.document.hidden) {
        this.unreadMentions = 0;
        this.updateTitle();
      }
    });

    this.loadActiveRooms();
    this.roomsInterval = setInterval(() => {
      if (!this.isLoggedIn) {
        this.loadActiveRooms();
      }
    }, 5000);

    const savedMode = localStorage.getItem('darkMode');
      if (savedMode && savedMode === 'true') {
        this.toggleDarkMode();
    }

    this.socket.fromEvent('history').subscribe((history: any) => {
      this.messages = history as Message[];
      this.cdr.detectChanges();
      this.shouldScroll = true;
    });

    this.notificationSound = new Audio('/universfield-new-notification-010-352755.mp3');
    this.notificationSound.volume = 0.4;

    this.socket.fromEvent('chat message').subscribe((message: any) => {
      const msg = message as Message;
      msg.createdAt = new Date();
      this.messages.push(msg);
      this.cdr.detectChanges();
      this.scrollToBottom();
      this.shouldScroll = true;

      if (
        msg.type === 'message' &&
        msg.username !== this.username &&
        this.isMentioningMe(msg.text) &&
        this.document.hidden
      ) {
        this.unreadMentions++;
        this.updateTitle();
        this.notificationSound.play().catch(() => {
        });
      }
    });

    this.socket.fromEvent('user typing').subscribe((username: any) => {
      this.typingUser = username as string;
      this.cdr.detectChanges();
    });

    this.socket.fromEvent('user stopped typing').subscribe(() => {
      this.typingUser = '';
      this.cdr.detectChanges();
    });

    this.socket.fromEvent('update user list').subscribe((users: any) => {
      this.usersInRoom = users as string[];
      this.cdr.detectChanges();
    });

    this.socket.fromEvent('message reaction updated').subscribe((data: any) => {
      const { messageId, reactions } = data;
      const message = this.messages.find(m => m._id === messageId);
      if (message) {
        message.reactions = reactions;
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.roomsInterval) {
      clearInterval(this.roomsInterval);
    }
  }

  private scrollToBottom(): void {
    try {
      this.messageListContainer.nativeElement.scrollTop = this.messageListContainer.nativeElement.scrollHeight;
    } catch(err) {
      console.error('Error al hacer scroll:', err);
    }
  }

  joinChat() {
    if (this.username && this.room) {
      this.isLoggedIn = true;
      this.socket.emit('join room', { room: this.room, username: this.username });
      this.cdr.detectChanges();
    }
  }

  sendMessage() {
    if (this.showMentionPopup) return;
    if (!this.newMessage.trim()) return;
    this.socket.emit('chat message', {
      room: this.room,
      message: this.newMessage,
      username: this.username
    });
    this.socket.emit('stop typing', { room: this.room });
    this.newMessage = '';
  }

  onTyping(): void {
    this.socket.emit('typing', { room: this.room, username: this.username });
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.socket.emit('stop typing', { room: this.room });
    }, 2000);
  }

  loadActiveRooms(): void {
    this.http.get<{ name: string; userCount: number }[]>(`${environment.apiUrl}/rooms`)
      .subscribe({
        next: (rooms) => {
          this.activeRooms = rooms;
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error loading active rooms:', err)
      });
  }

  selectRoom(roomName: string): void {
    this.room = roomName;
  }

  renderMessage(text: string): string {
    if (!text) return '';

    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    let result = escaped;

    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

    result = result.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

    result = result.replace(/(?<!\*)\*([^\*]+)\*(?!\*)/g, '<em>$1</em>');

    result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    result = result.replace(/@(\w+)/g, (match, username) => {
      const isRealUser = this.usersInRoom.includes(username);
      const isSelf = username === this.username;

      if (!isRealUser) return match;

      const className = isSelf ? 'mention mention-self' : 'mention';
      const color = this.getUsernameColor(username);
      return `<span class="${className}" style="color: ${color}">@${username}</span>`;
    });

    result = result.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    return result;
  }

  isMentioningMe(text: string): boolean {
    if (!text || !this.username) return false;
    const regex = new RegExp(`@${this.username}\\b`, 'i');
    return regex.test(text);
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    const cursorPos = input.selectionStart || 0;

    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      this.mentionStartPos = atMatch.index!;
      const query = atMatch[1].toLowerCase();

      this.mentionMatches = this.usersInRoom
        .filter(user =>
          user !== this.username &&
          user.toLowerCase().includes(query)
        )
        .slice(0, 5);

      this.showMentionPopup = this.mentionMatches.length > 0;
      this.selectedMentionIndex = 0;
    } else {
      this.showMentionPopup = false;
      this.mentionStartPos = -1;
    }

    this.onTyping();
  }

  //TO DO: hacer un tipo de advertencia para que puedas enterarte de que hay estas opciones de personalizacion en el texto

  selectMention(username: string): void {
    if (this.mentionStartPos === -1) return;

    const before = this.newMessage.substring(0, this.mentionStartPos);
    const afterAtPos = this.newMessage.indexOf(' ', this.mentionStartPos);
    const after = afterAtPos === -1
      ? ''
      : this.newMessage.substring(afterAtPos);

    this.newMessage = `${before}@${username} ${after}`.trimEnd() + ' ';
    this.showMentionPopup = false;
    this.mentionStartPos = -1;
    this.cdr.detectChanges();
  }

  handleMentionKey(event: KeyboardEvent): void {
    if (!this.showMentionPopup || this.mentionMatches.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedMentionIndex =
        (this.selectedMentionIndex + 1) % this.mentionMatches.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedMentionIndex =
        (this.selectedMentionIndex - 1 + this.mentionMatches.length) % this.mentionMatches.length;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.selectMention(this.mentionMatches[this.selectedMentionIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.showMentionPopup = false;
    }
  }

  private updateTitle(): void {
    if (this.unreadMentions > 0) {
      this.document.title = `(${this.unreadMentions}) ${this.originalTitle}`;
    } else {
      this.document.title = this.originalTitle;
    }
  }

  toggleEmojiPicker(messageId: string | undefined): void {
    if (!messageId) return;

    if (this.showEmojiPickerForMessage === messageId) {
      this.showEmojiPickerForMessage = null;
    } else {
      this.showEmojiPickerForMessage = messageId;
    }
  }

  reactToMessage(messageId: string | undefined, emoji: string): void {
    if (!messageId) return;

    this.socket.emit('toggle reaction', {
      messageId,
      emoji,
      username: this.username,
      room: this.room
    });

    this.showEmojiPickerForMessage = null;
  }

  getReactionEntries(reactions: { [emoji: string]: string[] } | undefined): Array<{ emoji: string; users: string[] }> {
    if (!reactions) return [];
    return Object.entries(reactions).map(([emoji, users]) => ({ emoji, users }));
  }

  hasUserReacted(users: string[]): boolean {
    return users.includes(this.username);
  }

}
