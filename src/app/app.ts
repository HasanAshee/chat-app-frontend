import { Component, OnInit, ChangeDetectorRef, Renderer2, Inject, DOCUMENT, ViewChild, ElementRef, AfterViewChecked, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Socket } from 'ngx-socket-io';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from './auth.service';
import { DmService, ConversationSummary, DmMessage } from './dm.service';

interface Message {
  _id?: string;
  text: string;
  username?: string;
  nameColor?: string;
  type: 'message' | 'notification';
  createdAt?: Date;
  reactions?: { [emoji: string]: string[] };
  replyTo?: string | null;
  replyToSnapshot?: ReplySnapshot | null;
}

interface ReplySnapshot {
  username: string;
  nameColor: string;
  text: string;
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
  activeRooms: { name: string; userCount: number; visibility?: string; requiresPassword?: boolean }[] = [];
  private roomsInterval: any;

  // Auth UI state
  loginMode: LoginMode = 'guest';
  authError = '';
  isAuthLoading = false;

  showSearchDropdown = false;
  searchQuery = '';
  searchResults: Array<{
    _id: string;
    text: string;
    username: string;
    nameColor: string;
    createdAt: string;
  }> = [];
  isSearching = false;
  private searchDebounceTimeout: any;

  showManageRoomModal = false;
  manageRoomInvited: string[] = [];
  manageRoomInviteInput = '';
  manageRoomError = '';
  isManagingRoom = false;

  dmInputs: { [conversationId: string]: string | undefined } = {};
  private dmTypingTimeouts: { [conversationId: string]: any } = {};

  mentionMatches: string[] = [];
  showMentionPopup = false;
  selectedMentionIndex = 0;
  private mentionStartPos = -1;

  showDmList = false;
  dmStartUsername = '';
  dmStartError = '';

  myRooms: Array<{
    _id: string;
    name: string;
    visibility: 'public' | 'password' | 'invite';
    ownerUsername: string;
    isOwner: boolean;
    invitedUsernames?: string[];
    createdAt: string;
  }> = [];

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

  replyingTo: Message | null = null;
  highlightedMessageId: string | null = null;

  readonly colorPresets = [
    '#d946ef', '#4ade80', '#f97316', '#3b82f6',
    '#ec4899', '#14b8a6', '#eab308', '#ef4444'
  ];

  showCreateRoomModal = false;
  newRoomName = '';
  newRoomVisibility: 'public' | 'password' | 'invite' = 'public';
  newRoomPassword = '';
  newRoomInvited = '';
  isCreatingRoom = false;
  createRoomError = '';

  showPasswordPrompt = false;
  passwordPromptRoom = '';
  passwordPromptValue = '';
  passwordPromptError = '';

  currentRoomMeta: { visibility: string; ownerUsername: string | null; isOwner: boolean } | null = null;

  constructor(
    private socket: Socket,
    private cdr: ChangeDetectorRef,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    public auth: AuthService,
    public dm: DmService
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

    (this.socket as any).ioSocket?.on?.('connect', () => {
      console.log('[socket] real connect event, isLoggedIn:', this.auth.isLoggedIn());
      if (this.auth.isLoggedIn()) {
        this.registerPersonalChannel();
      }
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
      const message = data?.message || 'Error al unirse a la sala';

      if (this.showPasswordPrompt) {
        this.passwordPromptError = message;
        this.cdr.detectChanges();
      } else {
        this.authError = message;
        this.isLoggedIn = false;
        this.cdr.detectChanges();
      }
    });

    this.socket.fromEvent('join success').subscribe((data: any) => {
      this.username = data.username;
      this.isLoggedIn = true;
      this.authError = '';
      this.showPasswordPrompt = false;
      this.passwordPromptRoom = '';
      this.passwordPromptValue = '';
      this.passwordPromptError = '';

      this.currentRoomMeta = data.roomMeta || null;

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
    if (this.auth.isLoggedIn()) {
      this.registerPersonalChannel();
      this.dm.loadConversations().subscribe();
      this.loadMyRooms();
    }

    this.socket.fromEvent('dm message').subscribe((data: any) => {
      const msg = data as DmMessage;
      this.dm.appendMessage(msg);
      this.cdr.detectChanges();
      this.scrollDmToBottom(msg.conversationId);

      const dmState = this.dm.openDms().find(d => d.conversationId === msg.conversationId);
      const myUsername = this.auth.currentUser()?.username;
      if (dmState && dmState.expanded && msg.from !== myUsername) {
        this.markDmAsReadIfPossible(msg.conversationId);
      }
    });

    this.socket.fromEvent('dm typing').subscribe((data: any) => {
      this.dm.setTypingForDm(data.conversationId, data.from);
      this.cdr.detectChanges();
      setTimeout(() => {
        this.dm.setTypingForDm(data.conversationId, null);
        this.cdr.detectChanges();
      }, 3000);
    });

    this.socket.fromEvent('dm stop typing').subscribe((data: any) => {
      this.dm.setTypingForDm(data.conversationId, null);
      this.cdr.detectChanges();
    });

    this.socket.fromEvent('dm read').subscribe((data: any) => {
      console.log('DM read by:', data.readBy, 'in conversation:', data.conversationId);
    });

    this.socket.fromEvent('join password required').subscribe((data: any) => {
      this.passwordPromptRoom = data.room;
      this.passwordPromptValue = '';
      this.passwordPromptError = '';
      this.showPasswordPrompt = true;
      this.cdr.detectChanges();

      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('.password-prompt-input');
        input?.focus();
      }, 50);
    });

    this.socket.fromEvent('kicked from room').subscribe((data: any) => {
      alert(`Fuiste expulsado de la sala: ${data.reason || ''}`);
      this.leaveRoom();
    });

    this.socket.fromEvent('room deleted').subscribe((data: any) => {
      alert(`La sala "${data.room}" fue borrada por el dueño.`);
      this.leaveRoom();
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
        this.registerPersonalChannel();
        this.dm.loadConversations().subscribe();
        this.loadMyRooms();
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
        this.registerPersonalChannel();
        this.dm.loadConversations().subscribe();
        this.loadMyRooms();
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
    this.dm.reset();
    this.myRooms = [];
    this.username = '';
    this.password = '';
  }

  leaveRoom(): void {
    this.socket.disconnect();
    this.socket.connect();
    this.isLoggedIn = false;
    this.messages = [];
    this.usersInRoom = [];
    this.room = '';
    if (!this.auth.isLoggedIn()) {
      this.username = '';
    } else {
      setTimeout(() => this.registerPersonalChannel(), 100);
    }
    this.cdr.detectChanges();
    this.loadActiveRooms();
    this.currentRoomMeta = null;
  }

  sendMessage() {
    if (this.showMentionPopup) return;
    if (!this.newMessage.trim()) return;

    const result = this.processCommand(this.newMessage);
    const replyToId = this.replyingTo?._id || undefined;

    if (result.handled) {
      if (result.messageToSend) {
        this.socket.emit('chat message', {
          room: this.room,
          message: result.messageToSend,
          username: this.username,
          replyToId
        });
      }
    } else {
      this.socket.emit('chat message', {
        room: this.room,
        message: this.newMessage,
        username: this.username,
        replyToId
      });
    }

    this.socket.emit('stop typing', { room: this.room });
    this.newMessage = '';
    this.replyingTo = null;
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

  startReply(msg: Message): void {
    if (!msg._id || msg.type !== 'message') return;
    this.replyingTo = msg;
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.message-input input');
      input?.focus();
    }, 0);
  }

  cancelReply(): void {
    this.replyingTo = null;
  }

  scrollToMessage(messageId: string | null | undefined): void {
    if (!messageId) return;
    const el = document.querySelector<HTMLElement>(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    this.highlightedMessageId = messageId;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.highlightedMessageId = null;
      this.cdr.detectChanges();
    }, 1500);
  }

  truncate(text: string | undefined, max: number = 80): string {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  toggleSearchDropdown(): void {
    this.showSearchDropdown = !this.showSearchDropdown;
    if (this.showSearchDropdown) {
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('.search-input');
        input?.focus();
      }, 50);
    } else {
      this.searchQuery = '';
      this.searchResults = [];
    }
  }

  closeSearchDropdown(): void {
    this.showSearchDropdown = false;
    this.searchQuery = '';
    this.searchResults = [];
  }

  onSearchInput(): void {
    clearTimeout(this.searchDebounceTimeout);

    const q = this.searchQuery.trim();
    if (q.length < 2) {
      this.searchResults = [];
      this.isSearching = false;
      return;
    }

    this.isSearching = true;
    this.searchDebounceTimeout = setTimeout(() => {
      this.runSearch(q);
    }, 300);
  }

  private runSearch(q: string): void {
    const params = new URLSearchParams({ room: this.room, q });
    this.http.get<any[]>(`${environment.apiUrl}/messages/search?${params.toString()}`)
      .subscribe({
        next: (results) => {
          this.searchResults = results;
          this.isSearching = false;
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Error buscando:', err);
          this.searchResults = [];
          this.isSearching = false;
          this.cdr.detectChanges();
        }
      });
  }

  selectSearchResult(messageId: string): void {
    this.closeSearchDropdown();
    setTimeout(() => {
      this.scrollToMessage(messageId);
    }, 100);
  }

  highlightMatch(text: string, query: string): SafeHtml {
    if (!text || !query) return text || '';

    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const escapedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    const match = escapedText.match(regex);
    let snippet = escapedText;
    if (match && escapedText.length > 100) {
      const matchIndex = escapedText.toLowerCase().indexOf(query.toLowerCase());
      const start = Math.max(0, matchIndex - 30);
      const end = Math.min(escapedText.length, matchIndex + query.length + 50);
      snippet = (start > 0 ? '…' : '') + escapedText.slice(start, end) + (end < escapedText.length ? '…' : '');
    }

    const highlighted = snippet.replace(regex, '<mark>$1</mark>');
    return this.sanitizer.bypassSecurityTrustHtml(highlighted);
  }

  private registerPersonalChannel(): void {
    const token = this.auth.getToken();
    if (!token) return;
    const connected = (this.socket as any).ioSocket?.connected;
    console.log('[DM] register user channel - socket connected?', connected);
    this.socket.emit('register user channel', { token });
  }

  toggleDmList(): void {
    this.showDmList = !this.showDmList;
    this.dmStartError = '';
    if (this.showDmList) {
      this.dm.loadConversations().subscribe();
    }
  }

  startNewDm(): void {
    const target = this.dmStartUsername.trim();
    if (!target) {
      this.dmStartError = 'Ingresá un nombre de usuario';
      return;
    }
    this.dmStartError = '';

    this.dm.openConversation(target).subscribe({
      next: (conv) => {
        this.dm.openDmFromConversation(conv);
        this.dmStartUsername = '';
        this.showDmList = false;
        this.loadDmHistory(conv._id);
        this.markDmAsReadIfPossible(conv._id);
      },
      error: (err) => {
        this.dmStartError = this.auth.getErrorMessage(err);
      }
    });
  }

  openDmFromList(conv: ConversationSummary): void {
    this.dm.openDmFromConversation(conv);
    this.showDmList = false;

    const dmState = this.dm.openDms().find(d => d.conversationId === conv._id);
    if (dmState && !dmState.loadedHistory) {
      this.loadDmHistory(conv._id);
    }
    this.markDmAsReadIfPossible(conv._id);
  }

  toggleDmExpand(conversationId: string): void {
    this.dm.toggleDmExpand(conversationId);

    const dmState = this.dm.openDms().find(d => d.conversationId === conversationId);
    if (dmState && dmState.expanded) {
      if (!dmState.loadedHistory) {
        this.loadDmHistory(conversationId);
      }
      this.markDmAsReadIfPossible(conversationId);
    }
  }

  private loadDmHistory(conversationId: string): void {
    this.dm.loadMessages(conversationId).subscribe({
      next: (messages) => {
        this.dm.setMessagesForDm(conversationId, messages);
        this.cdr.detectChanges();
        this.scrollDmToBottom(conversationId);
      },
      error: (err) => {
        console.error('Error cargando historial de DM:', err);
      }
    });
  }

  closeDm(conversationId: string): void {
    this.dm.closeDm(conversationId);
  }

  sendDmMessage(conversationId: string): void {
    const text = (this.dmInputs[conversationId] || '').trim();
    if (!text) return;

    const token = this.auth.getToken();
    if (!token) return;

    this.socket.emit('dm send', {
      conversationId,
      text,
      token
    });

    this.socket.emit('dm stop typing', { conversationId, token });

    this.dmInputs[conversationId] = '';
  }

  onDmInputChange(conversationId: string): void {
    const token = this.auth.getToken();
    if (!token) return;

    this.socket.emit('dm typing', { conversationId, token });

    clearTimeout(this.dmTypingTimeouts[conversationId]);
    this.dmTypingTimeouts[conversationId] = setTimeout(() => {
      this.socket.emit('dm stop typing', { conversationId, token });
    }, 2000);
  }

  trackDmMessage(_: number, msg: DmMessage): string {
    return msg._id;
  }

  scrollDmToBottom(conversationId: string): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-dm-id="${conversationId}"] .dm-messages-list`
      );
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 0);
  }

  private markDmAsReadIfPossible(conversationId: string): void {
    this.dm.markAsRead(conversationId).subscribe({
      error: (err) => console.error('Error marcando como leído:', err)
    });
  }

  canReplyInDm(msg: Message): boolean {
    if (!this.auth.isLoggedIn()) return false;
    if (!msg.username || msg.username === this.username) return false;

    const userInRoom = this.usersInRoom.find(u => u.username === msg.username);
    if (userInRoom && userInRoom.isGuest) return false;

    return true;
  }

  replyInDm(msg: Message): void {
    if (!msg.username) return;

    this.dm.openConversation(msg.username).subscribe({
      next: (conv) => {
        this.dm.openDmFromConversation(conv);

        const dmState = this.dm.openDms().find(d => d.conversationId === conv._id);
        if (dmState && !dmState.loadedHistory) {
          this.loadDmHistory(conv._id);
        }

        this.markDmAsReadIfPossible(conv._id);

        const quotePreview = this.truncate(msg.text, 120);
        const quoted = `> ${msg.username} dijo en #${this.room}: "${quotePreview}"\n\n`;
        this.dmInputs[conv._id] = quoted;

        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(
            `[data-dm-id="${conv._id}"] .dm-input`
          );
          input?.focus();
          if (input) {
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }, 100);

        this.cdr.detectChanges();
      },
      error: (err) => {
        const errMsg = this.auth.getErrorMessage(err);
        console.warn('No se pudo abrir DM:', errMsg);
        alert(`No se pudo iniciar DM con ${msg.username}: ${errMsg}`);
      }
    });
  }

  openCreateRoomModal(): void {
    this.showCreateRoomModal = true;
    this.newRoomName = '';
    this.newRoomVisibility = 'public';
    this.newRoomPassword = '';
    this.newRoomInvited = '';
    this.createRoomError = '';
  }

  closeCreateRoomModal(): void {
    this.showCreateRoomModal = false;
    this.createRoomError = '';
  }

  createRoom(): void {
    if (!this.auth.isLoggedIn()) {
      this.createRoomError = 'Necesitás estar logueado para crear salas';
      return;
    }

    const name = this.newRoomName.trim();
    if (!name) {
      this.createRoomError = 'Ponele nombre a la sala';
      return;
    }
    if (name.length < 2 || name.length > 32) {
      this.createRoomError = 'El nombre debe tener entre 2 y 32 caracteres';
      return;
    }
    if (!/^[\w-]+$/.test(name)) {
      this.createRoomError = 'Solo letras, números, _ y -';
      return;
    }
    if (this.newRoomVisibility === 'password' && this.newRoomPassword.length < 4) {
      this.createRoomError = 'La contraseña debe tener al menos 4 caracteres';
      return;
    }

    const body: any = {
      name,
      visibility: this.newRoomVisibility
    };

    if (this.newRoomVisibility === 'password') {
      body.password = this.newRoomPassword;
    }

    if (this.newRoomVisibility === 'invite') {
      const list = this.newRoomInvited
        .split(',')
        .map(u => u.trim())
        .filter(u => u.length > 0);
      body.invitedUsernames = list;
    }

    this.isCreatingRoom = true;
    this.createRoomError = '';

    const token = this.auth.getToken();
    this.http.post<any>(
      `${environment.apiUrl}/rooms`,
      body,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (room) => {
        this.isCreatingRoom = false;
        this.closeCreateRoomModal();
        this.room = room.name;
        this.loadMyRooms();
      },
      error: (err) => {
        this.isCreatingRoom = false;
        this.createRoomError = this.auth.getErrorMessage(err);
      }
    });
  }

  submitPasswordPrompt(): void {
    if (!this.passwordPromptValue) {
      this.passwordPromptError = 'Ingresá la contraseña';
      return;
    }

    this.passwordPromptError = '';

    if (this.auth.isLoggedIn()) {
      const token = this.auth.getToken();
      this.socket.emit('join room', {
        room: this.passwordPromptRoom,
        token,
        password: this.passwordPromptValue
      });
    } else {
      this.socket.emit('join room', {
        room: this.passwordPromptRoom,
        username: this.username,
        password: this.passwordPromptValue
      });
    }
  }

  cancelPasswordPrompt(): void {
      this.showPasswordPrompt = false;
      this.passwordPromptRoom = '';
      this.passwordPromptValue = '';
      this.passwordPromptError = '';
  }

  loadMyRooms(): void {
    if (!this.auth.isLoggedIn()) {
      this.myRooms = [];
      return;
    }
    const token = this.auth.getToken();
    this.http.get<any[]>(
      `${environment.apiUrl}/rooms/mine`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (rooms) => {
        this.myRooms = rooms;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando mis salas:', err);
      }
    });
  }

  getRoomIcon(visibility: string): string {
    if (visibility === 'password') return 'lock';
    if (visibility === 'invite') return 'invite';
    return 'public';
  }

  canManageCurrentRoom(): boolean {
  return this.isLoggedIn && this.currentRoomMeta?.isOwner === true;
}

  openManageRoomModal(): void {
    if (!this.canManageCurrentRoom()) return;

    this.closeHeaderMenu();
    this.showManageRoomModal = true;
    this.manageRoomError = '';
    this.manageRoomInviteInput = '';
    this.loadRoomDetails();
  }

  closeManageRoomModal(): void {
    this.showManageRoomModal = false;
    this.manageRoomError = '';
    this.manageRoomInviteInput = '';
  }

  private loadRoomDetails(): void {
    const token = this.auth.getToken();
    this.http.get<any>(
      `${environment.apiUrl}/rooms/${encodeURIComponent(this.room)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (data) => {
        this.manageRoomInvited = data.invitedUsernames || [];
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.manageRoomError = this.auth.getErrorMessage(err);
      }
    });
  }

  inviteToRoom(): void {
    const username = this.manageRoomInviteInput.trim();
    if (!username) return;

    this.isManagingRoom = true;
    this.manageRoomError = '';

    const token = this.auth.getToken();
    this.http.post<{ invitedUsernames: string[] }>(
      `${environment.apiUrl}/rooms/${encodeURIComponent(this.room)}/invite`,
      { username },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        this.isManagingRoom = false;
        this.manageRoomInvited = res.invitedUsernames;
        this.manageRoomInviteInput = '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isManagingRoom = false;
        this.manageRoomError = this.auth.getErrorMessage(err);
      }
    });
  }

  uninviteFromRoom(username: string): void {
    if (!confirm(`¿Sacar a ${username} de los invitados?`)) return;

    this.isManagingRoom = true;
    this.manageRoomError = '';

    const token = this.auth.getToken();
    this.http.post<{ invitedUsernames: string[] }>(
      `${environment.apiUrl}/rooms/${encodeURIComponent(this.room)}/uninvite`,
      { username },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        this.isManagingRoom = false;
        this.manageRoomInvited = res.invitedUsernames;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isManagingRoom = false;
        this.manageRoomError = this.auth.getErrorMessage(err);
      }
    });
  }

  deleteCurrentRoom(): void {
    if (!confirm(`¿Borrar la sala "${this.room}"? Esta acción no se puede deshacer y va a echar a todos los que estén adentro.`)) return;

    const token = this.auth.getToken();
    this.http.delete(
      `${environment.apiUrl}/rooms/${encodeURIComponent(this.room)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: () => {
        this.closeManageRoomModal();
        this.leaveRoom();
        this.loadMyRooms();
      },
      error: (err) => {
        this.manageRoomError = this.auth.getErrorMessage(err);
      }
    });
  }

}
