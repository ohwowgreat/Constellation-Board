// ─────────────────────────────────────────────────────────────
// Live sharing config (Constellation Board)
//
// To let a whole class work on the same board, this app needs a
// free Firebase Realtime Database. Follow the steps in README.md
// ("Sharing a board with a class"), then replace the line
// `window.FIREBASE_CONFIG = null;` below with the config object
// Firebase gives you. It looks like this:
//
// window.FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "your-project.firebaseapp.com",
//   databaseURL: "https://your-project-default-rtdb.firebaseio.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef"
// };
//
// The web config is safe to publish: access is controlled by the
// database rules in the Firebase console, not by this file.
// ─────────────────────────────────────────────────────────────
window.FIREBASE_CONFIG = null;
