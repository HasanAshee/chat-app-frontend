import { Component, OnInit, ChangeDetectorRef, Renderer2, Inject, DOCUMENT, ViewChild, ElementRef, AfterViewChecked, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Socket } from 'ngx-socket-io';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from './auth.service';

interface Message {
  _id?: string;
  text: string;
  username?: string;
  nameColor?: string;
  type: 'message' | 'notification';
  createdAt?: Date;
  reactions?: { [emoji: string]: string[] };
}

interface RoomUser {
  username: string;
  nameColor: string;
  isGuest: boolean;
}

type LoginMode = 'guest' | 'login' | 'register';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSlideToggleModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit, AfterViewChecked, OnDestroy {

  @ViewChild('messageListContainer') private messageListContainer!: ElementRef;

  newMessage = '';
  messages: Message[] = [];
  username = '';
  password = '';
  room = '';
  isLoggedIn = false;
  typingUser = '';
  usersInRoom: RoomUser[] = [];
  private typingTimeout: any;
  activeRooms: { name: string; userCount: number }[] = [];
  private roomsInterval: any;

  // Auth UI state
  loginMode: LoginMode = 'guest';
  authError = '';
  isAuthLoading = false;

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

  showHeaderMenu = false;

  showSettingsModal = false;
  selectedColor = '';
  isUpdatingColor = false;
  colorUpdateError = '';

  readonly colorPresets = [
    '#d946ef', '#4ade80', '#f97316', '#3b82f6',
    '#ec4899', '#14b8a6', '#eab308', '#ef4444'
  ];

  constructor(
    private socket: Socket,
    private cdr: ChangeDetectorRef,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    public auth: AuthService
  ) {}

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  private colorPalette = ['#d946ef', '#4ade80', '#f97316', '#3b82f6', '#ec4899', '#14b8a6'];

  getUsernameColor(username: string): string {
    const inRoom = this.usersInRoom.find(u => u.username === username);
    if (inRoom) return inRoom.nameColor;

    const msgWithColor = this.messages.find(m => m.username === username && m.nameColor);
    if (msgWithColor?.nameColor) return msgWithColor.nameColor;

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
      this.syncHistoricalColors();
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
        this.notificationSound.play().catch(() => {});
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
      this.usersInRoom = users as RoomUser[];
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

    this.socket.fromEvent('join error').subscribe((data: any) => {
      this.authError = data?.message || 'Error al unirse a la sala';
      this.isLoggedIn = false;
      this.cdr.detectChanges();
    });

    this.socket.fromEvent('join success').subscribe((data: any) => {
      this.username = data.username;
      this.isLoggedIn = true;
      this.authError = '';
      this.cdr.detectChanges();
    });

    this.socket.fromEvent('user color updated').subscribe((data: any) => {
      const { username, nameColor } = data;
      const u = this.usersInRoom.find(x => x.username === username);
      if (u) u.nameColor = nameColor;
      this.messages.forEach(m => {
        if (m.username === username) m.nameColor = nameColor;
      });
      this.cdr.detectChanges();
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
    } catch (err) {
      console.error('Error al hacer scroll:', err);
    }
  }

  // ========== AUTH UI ==========
  setLoginMode(mode: LoginMode): void {
    this.loginMode = mode;
    this.authError = '';
    this.password = '';
    const currentUser = this.auth.currentUser();
    if (currentUser && mode !== 'guest') {
      this.username = currentUser.username;
    }
  }

  loginAccount(): void {
    if (!this.username || !this.password) {
      this.authError = 'Completá usuario y contraseña';
      return;
    }
    this.isAuthLoading = true;
    this.authError = '';
    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        this.isAuthLoading = false;
        this.password = '';
      },
      error: (err) => {
        this.isAuthLoading = false;
        this.authError = this.auth.getErrorMessage(err);
      }
    });
  }

  registerAccount(): void {
    if (!this.username || !this.password) {
      this.authError = 'Completá usuario y contraseña';
      return;
    }
    this.isAuthLoading = true;
    this.authError = '';
    this.auth.register(this.username, this.password).subscribe({
      next: () => {
        this.isAuthLoading = false;
        this.password = '';
      },
      error: (err) => {
        this.isAuthLoading = false;
        this.authError = this.auth.getErrorMessage(err);
      }
    });
  }

  joinAsGuest(): void {
    if (!this.username || !this.room) {
      this.authError = 'Completá nombre y sala';
      return;
    }
    this.authError = '';
    this.socket.emit('join room', { room: this.room, username: this.username });
  }

  joinAsAuthenticated(): void {
    if (!this.room) {
      this.authError = 'Ingresá el nombre de la sala';
      return;
    }
    const token = this.auth.getToken();
    if (!token) {
      this.authError = 'Sesión perdida, volvé a iniciar sesión';
      return;
    }
    this.authError = '';
    this.socket.emit('join room', { room: this.room, token });
  }

  logout(): void {
    this.auth.logout();
    this.username = '';
    this.password = '';
  }

  // Sale de la sala actual y vuelve al login (sin desloguear la cuenta)
  leaveRoom(): void {
    this.socket.disconnect();
    this.socket.connect();
    this.isLoggedIn = false;
    this.messages = [];
    this.usersInRoom = [];
    this.room = '';
    if (!this.auth.isLoggedIn()) {
      this.username = '';
    }
    this.cdr.detectChanges();
    this.loadActiveRooms();
  }

  sendMessage() {
    if (this.showMentionPopup) return;
    if (!this.newMessage.trim()) return;

    const result = this.processCommand(this.newMessage);

    if (result.handled) {
      if (result.messageToSend) {
        this.socket.emit('chat message', {
          room: this.room,
          message: result.messageToSend,
          username: this.username
        });
      }
    } else {
      this.socket.emit('chat message', {
        room: this.room,
        message: this.newMessage,
        username: this.username
      });
    }

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

  private syncHistoricalColors(): void {
    const inRoomUsernames = new Set(this.usersInRoom.map(u => u.username));
    const historicalUsernames = new Set<string>();

    for (const msg of this.messages) {
      if (msg.username && !inRoomUsernames.has(msg.username)) {
        historicalUsernames.add(msg.username);
      }
    }

    if (historicalUsernames.size === 0) return;

    const usernamesParam = Array.from(historicalUsernames).join(',');
    this.http.get<{ [username: string]: string }>(
      `${environment.apiUrl}/users/colors?usernames=${encodeURIComponent(usernamesParam)}`
    ).subscribe({
      next: (colorMap) => {
        this.messages.forEach(msg => {
          if (msg.username && colorMap[msg.username]) {
            msg.nameColor = colorMap[msg.username];
          }
        });
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error sincronizando colores históricos:', err);
      }
    });
  }

  selectRoom(roomName: string): void {
    this.room = roomName;
  }

  renderMessage(text: string): SafeHtml {
    if (!text) return '';

    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    let result = escaped;

    result = result.replace(/\[\[RAINBOW\]\](.*?)\[\[\/RAINBOW\]\]/g, (_, innerText) => {
      const colors = ['#ff0000', '#ff7f00', '#ffd700', '#00cc00', '#0099ff', '#6600cc', '#ff00ff'];
      return innerText.split('').map((char: string, i: number) => {
        if (char === ' ') return char;
        return `<span style="color: ${colors[i % colors.length]}; font-weight: 600">${char}</span>`;
      }).join('');
    });

    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

    result = result.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

    result = result.replace(/(?<!\*)\*([^\*]+)\*(?!\*)/g, '<em>$1</em>');

    result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    result = result.replace(/@(\w+)/g, (match, username) => {
      const isRealUser = this.usersInRoom.some(u => u.username === username);
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

    return this.sanitizer.bypassSecurityTrustHtml(result);
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
        .filter(u =>
          u.username !== this.username &&
          u.username.toLowerCase().includes(query)
        )
        .map(u => u.username)
        .slice(0, 5);

      this.showMentionPopup = this.mentionMatches.length > 0;
      this.selectedMentionIndex = 0;
    } else {
      this.showMentionPopup = false;
      this.mentionStartPos = -1;
    }

    this.onTyping();
  }

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

  processCommand(rawMessage: string): { handled: boolean; messageToSend?: string } {
    const trimmed = rawMessage.trim();
    if (!trimmed.startsWith('/')) {
      return { handled: false };
    }

    const spaceIndex = trimmed.indexOf(' ');
    const command = spaceIndex === -1
      ? trimmed.slice(1).toLowerCase()
      : trimmed.slice(1, spaceIndex).toLowerCase();
    const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();

    switch (command) {
      case 'me': {
        if (!args) {
          this.addLocalSystemMessage('Uso: /me <acción>.');
          return { handled: true };
        }
        return { handled: true, messageToSend: `*${this.username} ${args}*` };
      }

      case 'clear': {
        this.messages = [];
        this.addLocalSystemMessage('Chat limpiado (solo en tu vista)');
        return { handled: true };
      }

      case 'help': {
        const helpText = [
          'Comandos disponibles:',
          '• /me <acción> — describe una acción',
          '• /clear — limpia tu vista del chat',
          '• /roll [NdM] — tira dados (default 1d6). Ejemplo: /roll 2d20',
          '• /coin — tira una moneda',
          '• /choose <op1>, <op2>, ... — elige una opción al azar',
          '• /rainbow <texto> — texto con colores arcoíris',
          '• /help — muestra esta ayuda'
        ].join('\n');
        this.addLocalSystemMessage(helpText);
        return { handled: true };
      }

      case 'roll': {
        const result = this.rollDice(args || '1d6');
        if (result === null) {
          this.addLocalSystemMessage('Formato inválido. Ejemplo: /roll 2d20');
          return { handled: true };
        }
        return { handled: true, messageToSend: `🎲 ${this.username} tiró ${result.formula}: **${result.total}** ${result.rolls.length > 1 ? `(${result.rolls.join(' + ')})` : ''}` };
      }

      case 'coin': {
        const outcome = Math.random() < 0.5 ? 'Cara' : 'Cruz';
        return { handled: true, messageToSend: `🪙 ${this.username} tiró una moneda: **${outcome}**` };
      }

      case 'choose': {
        if (!args) {
          this.addLocalSystemMessage('Uso: /choose opción1, opción2, opción3');
          return { handled: true };
        }
        const options = args.split(',').map(o => o.trim()).filter(o => o.length > 0);
        if (options.length < 2) {
          this.addLocalSystemMessage('Necesitás al menos 2 opciones separadas por coma');
          return { handled: true };
        }
        const choice = options[Math.floor(Math.random() * options.length)];
        return { handled: true, messageToSend: `🎯 ${this.username} eligió: **${choice}** (entre ${options.length} opciones)` };
      }

      case 'rainbow': {
        if (!args) {
          this.addLocalSystemMessage('Uso: /rainbow <texto>');
          return { handled: true };
        }
        return { handled: true, messageToSend: `[[RAINBOW]]${args}[[/RAINBOW]]` };
      }

      default: {
        this.addLocalSystemMessage(`Comando desconocido: /${command}. Usá /help para ver la lista.`);
        return { handled: true };
      }
    }
  }

  private rollDice(formula: string): { formula: string; rolls: number[]; total: number } | null {
    const match = formula.toLowerCase().match(/^(\d+)d(\d+)$/);
    if (!match) return null;

    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);

    if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;

    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }
    const total = rolls.reduce((a, b) => a + b, 0);
    return { formula: `${count}d${sides}`, rolls, total };
  }

  private addLocalSystemMessage(text: string): void {
    this.messages.push({
      text,
      type: 'notification',
      createdAt: new Date()
    });
    this.cdr.detectChanges();
    this.shouldScroll = true;
  }
  openSettings(): void {
    this.selectedColor = this.auth.currentUser()?.nameColor || '#3b82f6';
    this.colorUpdateError = '';
    this.showSettingsModal = true;
  }

  closeSettings(): void {
    this.showSettingsModal = false;
    this.colorUpdateError = '';
  }

  selectColor(color: string): void {
    this.selectedColor = color;
  }

  saveColor(): void {
    if (!this.auth.isLoggedIn()) return;
    if (!this.selectedColor) return;

    if (!/^#[0-9a-fA-F]{6}$/.test(this.selectedColor)) {
      this.colorUpdateError = 'Color inválido';
      return;
    }

    this.isUpdatingColor = true;
    this.colorUpdateError = '';

    this.auth.updateColor(this.selectedColor).subscribe({
      next: (user) => {
        this.isUpdatingColor = false;

        if (this.isLoggedIn && this.room) {
          this.socket.emit('color changed', { nameColor: user.nameColor });
        }

        const myEntry = this.usersInRoom.find(u => u.username === this.username);
        if (myEntry) myEntry.nameColor = user.nameColor;

        this.messages.forEach(m => {
          if (m.username === this.username) m.nameColor = user.nameColor;
        });

        this.cdr.detectChanges();
        this.closeSettings();
      },
      error: (err) => {
        this.isUpdatingColor = false;
        this.colorUpdateError = this.auth.getErrorMessage(err);
      }
    });
  }
  toggleHeaderMenu(): void {
    this.showHeaderMenu = !this.showHeaderMenu;
  }

  closeHeaderMenu(): void {
    this.showHeaderMenu = false;
  }

  menuToggleDarkMode(): void {
    this.toggleDarkMode();
  }

  menuOpenSettings(): void {
    this.closeHeaderMenu();
    this.openSettings();
  }

  menuLeaveRoom(): void {
    this.closeHeaderMenu();
    this.leaveRoom();
  }

  menuLogout(): void {
    this.closeHeaderMenu();
    this.leaveRoom();
    this.logout();
  }
}
