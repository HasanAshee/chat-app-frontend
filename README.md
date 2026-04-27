<img width="1224" height="941" alt="imagen" src="https://github.com/user-attachments/assets/4004a1f5-342b-4040-bfbc-ba8606cfefe8" /># Real-Time Chat App

A full-stack chat application with public rooms, private rooms, direct messages, user profiles, and rich messaging features. Built with Angular and a Node.js backend with Socket.io for real-time communication.

**Live demo:** [chap-appdemo.netlify.app](https://chap-appdemo.netlify.app)

> The first time you open the demo, it may take ~30 seconds to load — the backend is hosted on Render's free tier and goes to sleep when idle.

---

## Features

### Authentication & Profiles
- JWT-based authentication with persistent sessions
- Guest mode (no account required) coexists with registered users
- Public user profiles with editable bio, avatar (initials), member-since date, and message count
- Customizable name color (preset palette + custom hex picker)

### Messaging
- Real-time messaging with typing indicators, message history, and live user list
- Markdown formatting (bold, italic, strikethrough, inline code) and auto-link detection
- Slash commands: `/me`, `/roll`, `/coin`, `/choose`, `/rainbow`, `/clear`, `/help`
- Mentions with autocomplete, sound notification, and tab title badge when inactive
- Emoji reactions with live sync across clients
- Reply to messages with quoted preview and click-to-jump-to-original
- Edit color in real time and see other users' colors update live
- Delete messages: "for me" (hide locally) or "for everyone" (24h window, with placeholder)
- In-room message search with debounced live results and match highlighting

### Rooms
- Public rooms (created on-the-fly when joining)
- Private rooms with password (bcrypt-hashed)
- Invite-only rooms with dynamic invite/uninvite management
- Room ownership: owners can manage invites, change config, delete rooms
- Active rooms list with locks for password-protected ones
- "My rooms" section for rooms you own or where you're invited

### Direct Messages
- LinkedIn-style floating dock with up to 3 simultaneous chat popups
- Expand/minimize/close per conversation
- Unread count badges (per conversation and global)
- Live typing indicator inside expanded popups
- Auto mark-as-read when opening or receiving while expanded
- "Reply privately" button on room messages to start a DM with quoted context

### UX
- Light and dark mode
- Responsive design (desktop, tablet, mobile)
- Date separators between messages ("Today", "Yesterday", or full date)
- Markdown cheatsheet popover next to the input

---

## Tech Stack

- **Framework:** Angular 17+ (standalone components, signals, control flow)
- **Language:** TypeScript
- **Styling:** Plain CSS with custom properties for theming
- **Real-time:** Socket.io client (`ngx-socket-io`)
- **HTTP:** Angular's built-in HttpClient
- **State:** Angular signals for reactive state in services

---

## Architecture

The app is a single standalone Angular application with three injectable services:

- `AuthService` — login/register/logout, session persistence, name color, bio
- `DmService` — conversation list and open DM popups state
- `ProfileService` — fetches public user profiles

The main `AppComponent` orchestrates room state, the message list, the DM dock, and all modals. Communication with the backend is split between REST (auth, profiles, rooms config, search) and Socket.io (live messaging, typing, reactions, deletions).

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Local development

1. Clone the repo:
```bash
   git clone https://github.com/HasanAshee/chat-app-frontend.git
   cd chat-app-frontend
```

2. Install dependencies:
```bash
   npm install
```

3. Configure the API URL in `src/environments/environment.ts`:
```typescript
   export const environment = {
     production: false,
     apiUrl: 'http://localhost:3000'
   };
```

4. Run the dev server:
```bash
   npm start
```

5. Open `http://localhost:4200`. Make sure the backend is running on the URL set in `environment.ts`.

### Backend

The backend repository is at [chat-app-backend](https://github.com/HasanAshee/chat-app-backend).

---

## Screenshots

<img width="422" height="397" alt="Captura de pantalla 2026-04-27 112800" src="https://github.com/user-attachments/assets/52688f59-fa1d-4f86-9ad7-0655f8d2ef6f" />
<img width="1224" height="941" alt="imagen" src="https://github.com/user-attachments/assets/3772149f-445b-4438-aad8-d937608d48c7" />
<img width="737" height="708" alt="Captura de pantalla 2026-04-27 112657" src="https://github.com/user-attachments/assets/bfcee175-0c96-4608-b388-510504120e2c" />


---

## Author

**Facundo Hasan Carrizo**
- GitHub: [@HasanAshee](https://github.com/HasanAshee)
- Email: hasan.carrizo2002@gmail.com
