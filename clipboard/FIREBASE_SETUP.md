# ClipboardStack Firebase Setup

ClipboardStack Web works locally without Firebase. Use Firebase only when you want user accounts and remote sync across devices.

## Free Firebase Setup

1. Open <https://console.firebase.google.com/>.
2. Create a project on the free Spark plan.
3. Add a Web app.
4. Copy the Firebase Web app config into `firebase-config.js`.
5. Enable Authentication, then enable the Email/Password provider.
6. Create a Firestore database.
7. Paste `firestore.rules` into Firestore Rules and publish.

The config file should look like this:

```js
window.CLIPBOARDSTACK_FIREBASE_CONFIG = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  appId: "your-app-id",
};
```

## Remote Sync Notes

- Clips are stored at `users/{uid}/clips/{digest}`.
- Firestore rules only allow a signed-in user to access their own clips.
- Large screenshots stay local if they are too large for a single Firestore document.
- The app is manual-only: browsers do not allow a website to monitor clipboard or screen content in the background.
