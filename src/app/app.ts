import { Component, OnInit, ChangeDetectorRef, Renderer2, Inject, DOCUMENT, ViewChild, ElementRef, AfterViewChecked, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Socket } from 'ngx-socket-io';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';



interface Message {
  text: string;
  username?: string;
  type: 'message' | 'notification';
  createdAt?: Date;
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

    this.socket.fromEvent('chat message').subscribe((message: any) => {
      const msg = message as Message;
      msg.createdAt = new Date();
      this.messages.push(msg);
      this.cdr.detectChanges();
      this.scrollToBottom();
      this.shouldScroll = true;
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
}
