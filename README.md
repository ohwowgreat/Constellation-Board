# Constellation Board

Warburg style arrangement. Drop images and text on an infinite canvas, arrange them, export to PDF or JSON.

Live at: https://constellation.classroomtools.io/

## Where boards are saved

By default every board is saved in the browser you made it in (browser local storage). That is why a board made on one computer does not appear on another. To move a board between computers by hand, use **Export JSON** on one machine and **Import** on the other.

For a whole class working on one board at the same time, use a **live room** (below).

## Sharing a board with a class

A live room puts a board online so any number of laptops, plus the projector, see and edit the same thing in real time. Every change (adding, moving, resizing, typing, deleting, new boards, background colour) reaches everyone within a moment. The room stays saved online, so you can come back to it next lesson.

Live rooms need a free Firebase Realtime Database. This is a one-time setup, about five minutes.

### 1. Create a Firebase project

1. Go to https://console.firebase.google.com and sign in with a Google account.
2. **Create a project**, give it any name (for example `constellation-board`). Google Analytics can be turned off.

### 2. Create the database

1. In the left menu choose **Build → Realtime Database → Create database**.
2. Pick the location closest to your school.
3. Choose **Start in test mode** and click Enable.
4. Open the **Rules** tab, replace the contents with the rules below, and click **Publish**. Test mode rules switch themselves off after 30 days, these do not.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true,
        ".validate": "$room.matches(/^[A-Z0-9]{4,12}$/)"
      }
    }
  }
}
```

These rules let anyone who knows a room code read and edit that room, and nothing else. The room code is the only thing protecting a board, so treat it like a classroom door code: share it with the class, not publicly.

### 3. Get the web config

1. Click the gear next to **Project Overview → Project settings**.
2. Scroll to **Your apps** and click the web icon (`</>`).
3. Give the app a nickname, leave Firebase Hosting unticked, click **Register app**.
4. Copy the `firebaseConfig = { ... }` object it shows you.

### 4. Put the config in this project

Open `firebase-config.js`, replace the line `window.FIREBASE_CONFIG = null;` with your config so it reads:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
```

Commit and push to `main` (or edit the file directly on GitHub). The site at constellation.classroomtools.io redeploys from `main` within a minute or two. The web config is safe to publish: what people can do is governed by the database rules, not by the config.

### Using a room in class

1. On your computer, open the board you want to share and click **Share → Create room**. The board is copied into a new room and you get a six character code and a link.
2. Put the link or the code on the projector. Students open the link, or open the site and use **Share → Join** with the code.
3. Everyone edits together. The bar at the top shows the code and how many people are connected.
4. **Leave** returns you to your own private boards. The room keeps everything; rejoin with the code (recent rooms are listed under Share).

Notes:

- Inside a room, the tabs are the room's boards. Adding, renaming, duplicating, deleting and importing boards all happen in the room for everyone.
- Export JSON and Export PDF work in a room exactly as they do on private boards.
- Images are shrunk to at most 1600 px on their longest side when added, so a class full of photos stays fast. The free Firebase plan allows 1 GB of storage and 10 GB of downloads per month, which is plenty for classroom use.
- If two people edit the same text box at the same moment, the last edit wins.
