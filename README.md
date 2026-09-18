# Constellation Board

Warburg style arrangement. Drop images and text on an infinite canvas, arrange them, export to PDF or JSON.

Live at: https://constellation.classroomtools.io/

The main page lists every live room, with the names of the people working in each one, so a class can make its own rooms and the teacher can open any of them. See "The room list" below.

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
    },
    "directory": {
      ".read": true,
      "$room": {
        ".write": "$room.matches(/^[A-Z0-9]{4,12}$/)",
        "name":      { ".validate": "newData.isString() && newData.val().length <= 80" },
        "names":     { ".validate": "newData.isString() && newData.val().length <= 120" },
        "createdAt": { ".validate": "newData.isNumber()" },
        "updatedAt": { ".validate": "newData.isNumber()" },
        "$other":    { ".validate": false }
      }
    }
  }
}
```

These rules let anyone who knows a room code read and edit that room, and nothing else. The room code is the only thing protecting a board, so treat it like a classroom door code: share it with the class, not publicly.

The `directory` block is what makes the room list on the main page possible. It holds one small entry per room (its name, the names of the people on it, and when it was last used), readable by everyone, and never the boards themselves. **If you set the database up before the room list existed, open the Rules tab, add the `directory` block, and publish.** Until then the app keeps working, and the Rooms panel says that the rule is missing.

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
4. **Leave** returns you to your own private boards. The room keeps everything; rejoin with the code (recent rooms are listed under Share, and every room is listed under Rooms).

### The room list

The **Rooms** panel on the right of the main page lists every live room in the database, most recently used first. Each entry shows the room's name, who is working on it, its code, when it was last used, and how many people are in it right now. Click an entry to open the room. The **Rooms** button at the top hides and shows the panel; the panel closes on its own when you enter a room.

This is how a class makes its own rooms:

1. A student (or a pair) clicks **New room**, gives the room a name and types their names ("Ayşe, Bora"). The board on screen goes online with a code and a link, and the room appears in the list for everyone.
2. A partner opens the site, finds the room in the list and clicks it, or opens the link. Both edit the same board.
3. The names sit in the live bar at the top of the room. **Edit** there changes the room's name or the names; everyone in the room and the list see the change at once.
4. The teacher opens the site and sees every room, with names and who is online, and opens any of them from the list.

**New room** from inside a room starts a fresh, empty room and moves you into it; the room you were in stays online. **Share → Create room** does the same as **New room** for the board on screen.

Rooms made before the list existed have no entry in it. Each one appears the first time anyone opens it again (by code or link), named after its first board and without names until someone adds them with **Edit**.

Two things to know before turning this on. Anyone who opens the site sees the list and can open any room from it: before the list, a room was reachable only by its code, and now the codes are on the main page. That is the point for a class, but it means no room is private any more. And there is no way to delete a room, from the list or otherwise; a room stays until it is removed in the Firebase console (Realtime Database → Data → `rooms` and `directory`).

Notes:

- Inside a room, the tabs are the room's boards. Adding, renaming, duplicating, deleting and importing boards all happen in the room for everyone.
- Export JSON and Export PDF work in a room exactly as they do on private boards.
- Images are shrunk to at most 1600 px on their longest side when added, so a class full of photos stays fast. The free Firebase plan allows 1 GB of storage and 10 GB of downloads per month, which is plenty for classroom use.
- If two people edit the same text box at the same moment, the last edit wins.
