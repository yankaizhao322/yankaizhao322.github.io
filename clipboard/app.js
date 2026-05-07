const STORAGE_KEY = "clipboardstack.web.clips";
const MAX_ITEMS = 200;
const MAX_STORAGE_BYTES = 8 * 1024 * 1024;
const REMOTE_LIMIT = 120;
const MAX_REMOTE_CLIP_BYTES = 900 * 1024;
const MAX_TAGS = 8;
const SHARE_CODE_TTL_MS = 60 * 60 * 1000;
const SHARE_CODE_RETRIES = 12;
const MAX_SHARE_CLIPS = 20;
const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;
const SCREENSHOT_PRESETS = {
  fast: { maxEdge: 720, quality: 0.68 },
  balanced: { maxEdge: 1280, quality: 0.82 },
  sharp: { maxEdge: 1920, quality: 0.88 },
};

const state = {
  clips: normalizeClips(loadRawClips()),
  index: new Map(),
  query: "",
  filter: "all",
  dateFilter: "",
  selectedIds: new Set(),
  remote: {
    available: false,
    auth: null,
    db: null,
    user: null,
  },
  verificationCooldownUntil: 0,
  verificationCooldownTimer: null,
  editor: {
    clip: null,
    mode: "draw",
    image: null,
    history: [],
    isPointerDown: false,
    lastPoint: null,
    cropStart: null,
    cropBox: null,
    cropBase: null,
  },
};

const elements = {
  clipInput: document.querySelector("#clipInput"),
  saveTextButton: document.querySelector("#saveTextButton"),
  readClipboardButton: document.querySelector("#readClipboardButton"),
  screenshotButton: document.querySelector("#screenshotButton"),
  transferOpenButton: document.querySelector("#transferOpenButton"),
  captureCategoryInput: document.querySelector("#captureCategoryInput"),
  categoryOptions: document.querySelector("#categoryOptions"),
  shareCodeButton: document.querySelector("#shareCodeButton"),
  shareCodeLine: document.querySelector("#shareCodeLine"),
  retrieveCodeInput: document.querySelector("#retrieveCodeInput"),
  retrieveCodeButton: document.querySelector("#retrieveCodeButton"),
  screenshotPreset: document.querySelector("#screenshotPreset"),
  screenshotMaxEdge: document.querySelector("#screenshotMaxEdge"),
  exportButton: document.querySelector("#exportButton"),
  importFile: document.querySelector("#importFile"),
  clearButton: document.querySelector("#clearButton"),
  searchInput: document.querySelector("#searchInput"),
  dateFilterInput: document.querySelector("#dateFilterInput"),
  filterSelect: document.querySelector("#filterSelect"),
  clipList: document.querySelector("#clipList"),
  clipTemplate: document.querySelector("#clipTemplate"),
  statusLine: document.querySelector("#statusLine"),
  permissionPill: document.querySelector("#permissionPill"),
  metricTotal: document.querySelector("#metricTotal"),
  metricPinned: document.querySelector("#metricPinned"),
  metricBytes: document.querySelector("#metricBytes"),
  authForm: document.querySelector("#authForm"),
  accountOpenButton: document.querySelector("#accountOpenButton"),
  accountModal: document.querySelector("#accountModal"),
  accountCloseButton: document.querySelector("#accountCloseButton"),
  transferModal: document.querySelector("#transferModal"),
  transferCloseButton: document.querySelector("#transferCloseButton"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  confirmPasswordInput: document.querySelector("#confirmPasswordInput"),
  signInButton: document.querySelector("#signInButton"),
  createAccountButton: document.querySelector("#createAccountButton"),
  forgotPasswordButton: document.querySelector("#forgotPasswordButton"),
  verifyEmailButton: document.querySelector("#verifyEmailButton"),
  refreshUserButton: document.querySelector("#refreshUserButton"),
  signOutButton: document.querySelector("#signOutButton"),
  verificationNotice: document.querySelector("#verificationNotice"),
  accountSettings: document.querySelector("#accountSettings"),
  currentPasswordInput: document.querySelector("#currentPasswordInput"),
  newPasswordInput: document.querySelector("#newPasswordInput"),
  confirmNewPasswordInput: document.querySelector("#confirmNewPasswordInput"),
  changePasswordButton: document.querySelector("#changePasswordButton"),
  syncPill: document.querySelector("#syncPill"),
  accountLine: document.querySelector("#accountLine"),
  bulkActions: document.querySelector("#bulkActions"),
  selectionLine: document.querySelector("#selectionLine"),
  selectAllButton: document.querySelector("#selectAllButton"),
  pinSelectedButton: document.querySelector("#pinSelectedButton"),
  deleteSelectedButton: document.querySelector("#deleteSelectedButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  imageEditor: document.querySelector("#imageEditor"),
  editorCanvas: document.querySelector("#editorCanvas"),
  editorStatus: document.querySelector("#editorStatus"),
  editorCloseButton: document.querySelector("#editorCloseButton"),
  drawModeButton: document.querySelector("#drawModeButton"),
  cropModeButton: document.querySelector("#cropModeButton"),
  drawColorInput: document.querySelector("#drawColorInput"),
  drawSizeInput: document.querySelector("#drawSizeInput"),
  editorUndoButton: document.querySelector("#editorUndoButton"),
  editorResetButton: document.querySelector("#editorResetButton"),
  editorSaveButton: document.querySelector("#editorSaveButton"),
};

rebuildIndex();
trimHistory();
elements.screenshotMaxEdge.disabled = true;
initializeRemote();

function loadRawClips() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeClips(clips) {
  return clips
    .map((clip) => {
      const kind = clip.kind === "image" ? "image" : "text";
      const content = kind === "image" ? clip.imageData : clip.text;
      if (typeof content !== "string" || !content.trim()) {
        return null;
      }
      return {
        id: typeof clip.id === "string" ? clip.id : makeId(),
        kind,
        text: kind === "text" ? content : "",
        imageData: kind === "image" ? content : "",
        title: typeof clip.title === "string" ? clip.title : (kind === "image" ? "Screenshot" : ""),
        folder: typeof clip.folder === "string" ? clip.folder.trim() : "",
        tags: normalizeTags(clip.tags),
        digest: typeof clip.digest === "string" ? clip.digest : fallbackDigest(content),
        pinned: Boolean(clip.pinned),
        createdAt: typeof clip.createdAt === "string" ? clip.createdAt : new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, MAX_TAGS);
}

function parseTags(value) {
  return normalizeTags(String(value || "").split(","));
}

function currentCategory() {
  return String(elements.captureCategoryInput.value || "").trim().slice(0, 80);
}

function categoryOptions() {
  return [...new Set(state.clips.map((clip) => clip.folder).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function cloneShareClip(clip) {
  const kind = clip.kind === "image" ? "image" : "text";
  return {
    kind,
    text: kind === "text" ? String(clip.text || "") : "",
    imageData: kind === "image" ? String(clip.imageData || "") : "",
    title: typeof clip.title === "string" ? clip.title : "",
    folder: typeof clip.folder === "string" ? clip.folder : "",
    tags: normalizeTags(clip.tags),
    digest: typeof clip.digest === "string" ? clip.digest : fallbackDigest(kind === "image" ? clip.imageData : clip.text),
    pinned: false,
    createdAt: new Date().toISOString(),
  };
}

function sharePayloadBytes(clips) {
  return clips.reduce((total, clip) => total + estimatedClipBytes(clip), 0);
}

async function shareClipPayload(clips) {
  if (clips.length === 1) {
    return clips[0];
  }
  const bundle = JSON.stringify(clips);
  return {
    kind: "text",
    text: `Shared selection: ${clips.length} clips`,
    imageData: bundle,
    title: "Shared selection",
    folder: "",
    tags: ["bundle"],
    digest: await digestValue(`bundle:${bundle}`),
    pinned: false,
    createdAt: new Date().toISOString(),
  };
}

function clipsFromShareData(data) {
  if (Array.isArray(data?.clips)) {
    return data.clips;
  }
  const clip = data?.clip;
  if (!clip) {
    return [];
  }
  if (clip.title === "Shared selection" && typeof clip.imageData === "string") {
    try {
      const parsed = JSON.parse(clip.imageData);
      return Array.isArray(parsed) ? parsed : [clip];
    } catch {
      return [clip];
    }
  }
  return [clip];
}

function mergeClipLists(first, second) {
  const byDigest = new Map();
  for (const clip of [...first, ...second]) {
    const existing = byDigest.get(clip.digest);
    if (!existing) {
      byDigest.set(clip.digest, clip);
      continue;
    }

    const clipTime = Date.parse(clip.createdAt) || 0;
    const existingTime = Date.parse(existing.createdAt) || 0;
    const newest = clipTime >= existingTime ? clip : existing;
    byDigest.set(clip.digest, {
      ...newest,
      pinned: Boolean(existing.pinned || clip.pinned),
    });
  }

  return [...byDigest.values()].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return Number(right.pinned) - Number(left.pinned);
    }
    return (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0);
  });
}

function rebuildIndex() {
  state.index = new Map();
  state.clips.forEach((clip, position) => {
    state.index.set(clip.digest, position);
  });
}

function remoteCollection() {
  if (!state.remote.user?.emailVerified || !state.remote.db) {
    return null;
  }
  return state.remote.db
    .collection("users")
    .doc(state.remote.user.uid)
    .collection("clips");
}

function shareCollection() {
  if (!state.remote.available || !state.remote.db) {
    return null;
  }
  return state.remote.db.collection("publicShares");
}

async function fetchRemoteClips() {
  const collection = remoteCollection();
  if (!collection) {
    return [];
  }
  const snapshot = await collection.orderBy("createdAt", "desc").limit(REMOTE_LIMIT).get();
  return normalizeClips(snapshot.docs.map((doc) => doc.data()));
}

async function saveRemoteClip(clip) {
  const collection = remoteCollection();
  if (!collection) {
    return;
  }
  if (estimatedClipBytes(clip) > MAX_REMOTE_CLIP_BYTES) {
    setAccountStatus("Clip saved locally, but it is too large for free remote sync.");
    return;
  }
  try {
    await collection.doc(clip.digest).set(clip);
    setAccountStatus(`Synced ${state.clips.length} clips to ${state.remote.user.email}.`);
  } catch {
    setAccountStatus("Remote sync failed. Local history is still saved.");
  }
}

async function deleteRemoteClip(clip) {
  const collection = remoteCollection();
  if (!collection || !clip?.digest) {
    return;
  }
  try {
    await collection.doc(clip.digest).delete();
    setAccountStatus("Deleted from remote sync.");
  } catch {
    setAccountStatus("Remote delete failed. Local delete is saved.");
  }
}

async function clearRemoteClips() {
  const collection = remoteCollection();
  if (!collection) {
    return;
  }
  try {
    const snapshot = await collection.get();
    const batch = state.remote.db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    setAccountStatus("Remote history cleared.");
  } catch {
    setAccountStatus("Remote clear failed. Local history was cleared.");
  }
}

async function syncAllLocalClips() {
  const collection = remoteCollection();
  if (!collection) {
    return;
  }
  const syncable = state.clips
    .filter((clip) => estimatedClipBytes(clip) <= MAX_REMOTE_CLIP_BYTES)
    .slice(0, REMOTE_LIMIT);
  if (!syncable.length) {
    return;
  }
  const batch = state.remote.db.batch();
  syncable.forEach((clip) => {
    batch.set(collection.doc(clip.digest), clip);
  });
  await batch.commit();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.clips));
}

function firebaseConfig() {
  const config = globalThis.CLIPBOARDSTACK_FIREBASE_CONFIG || {};
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  if (!required.every((key) => typeof config[key] === "string" && config[key].trim())) {
    return null;
  }
  return config;
}

function initializeRemote() {
  const config = firebaseConfig();
  if (!config || !globalThis.firebase?.initializeApp) {
    updateAccountUi();
    return;
  }

  try {
    globalThis.firebase.initializeApp(config);
    state.remote.auth = globalThis.firebase.auth();
    state.remote.db = globalThis.firebase.firestore();
    state.remote.available = true;
    state.remote.auth.setPersistence(globalThis.firebase.auth.Auth.Persistence.LOCAL).catch(() => {
      setAccountStatus("This browser blocked persistent sign-in.");
    });
    state.remote.auth.onAuthStateChanged(handleAuthState);
    window.addEventListener("focus", () => refreshVerificationStatus(true));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshVerificationStatus(true);
      }
    });
    updateAccountUi();
  } catch {
    state.remote.available = false;
    setAccountStatus("Remote sync could not start. Check Firebase config.");
    updateAccountUi();
  }
}

async function handleAuthState(user) {
  state.remote.user = user;
  updateAccountUi();
  if (!user) {
    setAccountStatus(state.remote.available ? "Signed out. Local history is still saved here." : "Remote sync needs Firebase config.");
    return;
  }

  if (!user.emailVerified) {
    setAccountStatus(`Signed in as ${user.email}. Verify your email before remote sync turns on.`);
    return;
  }

  setAccountStatus("Loading remote clips...");
  try {
    const remoteClips = await fetchRemoteClips();
    state.clips = mergeClipLists(remoteClips, state.clips);
    rebuildIndex();
    trimHistory();
    persistWithQuotaTrim();
    render();
    await syncAllLocalClips();
    setAccountStatus(`Signed in as ${user.email}. Remote sync is on.`);
  } catch {
    setAccountStatus("Signed in, but remote clips could not load.");
  }
}

function updateAccountUi() {
  const signedIn = Boolean(state.remote.user);
  const needsVerification = Boolean(state.remote.user && !state.remote.user.emailVerified);
  const cooldownRemaining = Math.max(0, state.verificationCooldownUntil - Date.now());
  elements.signInButton.hidden = signedIn;
  elements.createAccountButton.hidden = signedIn;
  elements.forgotPasswordButton.hidden = signedIn;
  elements.verifyEmailButton.hidden = !needsVerification;
  elements.verifyEmailButton.disabled = cooldownRemaining > 0;
  elements.verifyEmailButton.textContent = cooldownRemaining > 0
    ? `Resend in ${Math.ceil(cooldownRemaining / 1000)}s`
    : "Verify Email";
  elements.refreshUserButton.hidden = !needsVerification;
  elements.signOutButton.hidden = !signedIn;
  elements.verificationNotice.hidden = !needsVerification;
  elements.accountSettings.hidden = !signedIn;
  elements.emailInput.disabled = signedIn || !state.remote.available;
  elements.passwordInput.disabled = signedIn || !state.remote.available;
  elements.confirmPasswordInput.disabled = signedIn || !state.remote.available;
  elements.currentPasswordInput.disabled = !signedIn || !state.remote.available;
  elements.newPasswordInput.disabled = !signedIn || !state.remote.available;
  elements.confirmNewPasswordInput.disabled = !signedIn || !state.remote.available;
  elements.changePasswordButton.disabled = !signedIn || !state.remote.available;
  elements.syncPill.textContent = signedIn
    ? (needsVerification ? "Verify email" : "Synced")
    : (state.remote.available ? "Ready" : "Local only");
  elements.accountOpenButton.textContent = signedIn
    ? (needsVerification ? "Verify Account" : "Account Synced")
    : "Account";
  if (!state.remote.available) {
    elements.accountLine.textContent = "Add Firebase config to enable free remote accounts. Local history still works.";
  } else if (needsVerification) {
    elements.accountLine.textContent = verificationHelpText(state.remote.user.email);
  }
}

function setAccountStatus(message) {
  elements.accountLine.textContent = message;
}

function verificationHelpText(email) {
  return `Verification email sent to ${email}. Check your inbox and spam folder, confirm the address is spelled correctly, and wait a few minutes before resending. Do not click unexpected links; only use the verification email you requested from ClipboardStack.`;
}

function scheduleVerificationCooldownTick() {
  if (state.verificationCooldownTimer) {
    clearTimeout(state.verificationCooldownTimer);
    state.verificationCooldownTimer = null;
  }
  const remaining = state.verificationCooldownUntil - Date.now();
  if (remaining <= 0) {
    updateAccountUi();
    return;
  }
  state.verificationCooldownTimer = setTimeout(() => {
    updateAccountUi();
    scheduleVerificationCooldownTick();
  }, Math.min(1000, remaining));
}

function startVerificationCooldown() {
  state.verificationCooldownUntil = Date.now() + EMAIL_RESEND_COOLDOWN_MS;
  updateAccountUi();
  scheduleVerificationCooldownTick();
}

function persistWithQuotaTrim() {
  let removedForQuota = false;
  while (true) {
    try {
      persist();
      if (removedForQuota && !state.clips.length) {
        setStatus("Storage is full, so the newest clip could not be kept.");
      }
      return true;
    } catch {
      if (!state.clips.length) {
        return false;
      }
      const removableIndex = findLastRemovableIndex();
      if (removableIndex === -1) {
        return false;
      }
      state.clips.splice(removableIndex, 1);
      rebuildIndex();
      removedForQuota = true;
    }
  }
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function digestValue(value) {
  if (!globalThis.crypto?.subtle) {
    return fallbackDigest(value);
  }

  const data = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackDigest(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function addTextClip(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    setStatus("Nothing to save yet.");
    return;
  }

  await addClip({
    kind: "text",
    text: normalized,
    imageData: "",
    title: "",
    folder: currentCategory(),
    digest: await digestValue(`text:${normalized}`),
  });
}

async function addImageClip(imageData, title) {
  await addClip({
    kind: "image",
    text: "",
    imageData,
    title,
    folder: currentCategory(),
    digest: await digestValue(`image:${imageData}`),
  });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function authInputs() {
  return {
    email: elements.emailInput.value.trim(),
    password: elements.passwordInput.value,
    confirmPassword: elements.confirmPasswordInput.value,
  };
}

function passwordChangeInputs() {
  return {
    currentPassword: elements.currentPasswordInput.value,
    newPassword: elements.newPasswordInput.value,
    confirmNewPassword: elements.confirmNewPasswordInput.value,
  };
}

function verificationActionSettings() {
  if (window.location.hostname !== "yankaizhao322.github.io") {
    return undefined;
  }
  return {
    url: `${window.location.origin}${window.location.pathname}`,
    handleCodeInApp: false,
  };
}

async function sendVerificationEmail(user) {
  await user.sendEmailVerification(verificationActionSettings());
  startVerificationCooldown();
}

function supportsPasswordChange(user) {
  return user?.providerData?.some((provider) => provider.providerId === "password");
}

async function changePassword() {
  const user = state.remote.auth?.currentUser;
  if (!user) {
    setAccountStatus("Sign in before changing your password.");
    return;
  }
  if (!supportsPasswordChange(user)) {
    setAccountStatus("Password change is only available for email/password accounts.");
    return;
  }

  const { currentPassword, newPassword, confirmNewPassword } = passwordChangeInputs();
  if (!currentPassword) {
    setAccountStatus("Enter your current password first.");
    return;
  }
  if (newPassword.length < 8) {
    setAccountStatus("New password needs at least 8 characters.");
    return;
  }
  if (newPassword !== confirmNewPassword) {
    setAccountStatus("New passwords do not match. Re-enter both new password fields.");
    return;
  }

  try {
    elements.changePasswordButton.disabled = true;
    const credential = globalThis.firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPassword);
    elements.currentPasswordInput.value = "";
    elements.newPasswordInput.value = "";
    elements.confirmNewPasswordInput.value = "";
    setAccountStatus("Password changed. Use the new password next time you sign in.");
  } catch (error) {
    setAccountStatus(authErrorMessage(error, "Change password"));
  } finally {
    updateAccountUi();
  }
}

async function refreshVerificationStatus(silent = false) {
  const user = state.remote.auth?.currentUser;
  if (!user || user.emailVerified) {
    return;
  }
  try {
    await user.reload();
    const refreshed = state.remote.auth.currentUser;
    if (refreshed?.emailVerified) {
      await handleAuthState(refreshed);
    } else if (!silent) {
      setAccountStatus(`Still waiting for ${refreshed.email} to verify email. Check spam and use only the verification email you requested from ClipboardStack.`);
    }
  } catch {
    if (!silent) {
      setAccountStatus("Could not refresh verification status. Try signing out and back in.");
    }
  }
}

function authErrorMessage(error, action) {
  const code = error?.code || "";
  if (code === "auth/email-already-in-use") {
    return "This email already has an account. Sign in or use Forgot Password.";
  }
  if (code === "auth/invalid-email") {
    return "Use a real email address, like name@example.com.";
  }
  if (code === "auth/weak-password") {
    return action === "Change password"
      ? "New password is too weak. Use at least 8 characters."
      : "Password is too weak. Use at least 6 characters.";
  }
  if (code === "auth/wrong-password") {
    return action === "Change password"
      ? "Current password is wrong."
      : "Sign in failed. Check the email and password, or use Forgot Password.";
  }
  if (code === "auth/invalid-credential") {
    return action === "Change password"
      ? "Current password is wrong."
      : "Sign in failed. Check the email and password, or use Forgot Password.";
  }
  if (code === "auth/user-not-found") {
    return "Sign in failed. Check the email and password, or use Forgot Password.";
  }
  if (code === "auth/requires-recent-login") {
    return "For security, sign out and sign in again, then retry the password change.";
  }
  if (code === "auth/network-request-failed") {
    return "Network request failed. Check your connection or browser blockers, then retry.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email/password auth is not enabled. Enable it in Firebase Authentication > Sign-in method.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Wait a bit, then try again.";
  }
  return `${action} failed. Try again in a moment.`;
}

function makeShareCode() {
  const array = new Uint32Array(1);
  globalThis.crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

function normalizeShareCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

async function clipFromCaptureOrLatest() {
  const text = elements.clipInput.value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (text) {
    return {
      kind: "text",
      text,
      imageData: "",
      title: "",
      folder: currentCategory(),
      tags: [],
      digest: await digestValue(`text:${text}`),
      pinned: false,
      createdAt: new Date().toISOString(),
    };
  }
  return state.clips[0] ? cloneShareClip(state.clips[0]) : null;
}

async function clipsForShareCode() {
  const selected = state.clips
    .filter((clip) => state.selectedIds.has(clip.id))
    .slice(0, MAX_SHARE_CLIPS)
    .map(cloneShareClip);
  if (selected.length) {
    return selected;
  }
  const clip = await clipFromCaptureOrLatest();
  return clip ? [clip] : [];
}

async function generateShareCode() {
  const collection = shareCollection();
  if (!collection) {
    setStatus("Code transfer needs Firebase config.");
    return;
  }

  const clips = await clipsForShareCode();
  if (!clips.length) {
    setStatus("Select clips, save something, or type content before generating a code.");
    return;
  }
  if (state.selectedIds.size > MAX_SHARE_CLIPS) {
    setStatus(`Code transfer can share up to ${MAX_SHARE_CLIPS} selected clips at a time.`);
    return;
  }
  const shareClip = await shareClipPayload(clips);
  if (estimatedClipBytes(shareClip) > MAX_REMOTE_CLIP_BYTES || sharePayloadBytes(clips) > MAX_REMOTE_CLIP_BYTES) {
    setStatus("Selected clips are too large for one code.");
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_CODE_TTL_MS);
  for (let attempt = 0; attempt < SHARE_CODE_RETRIES; attempt += 1) {
    const code = makeShareCode();
    const ref = collection.doc(code);
    try {
      const saved = await state.remote.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) {
          const existingExpiry = snapshot.data()?.expiresAt?.toDate?.();
          if (!existingExpiry || existingExpiry > now) {
            return false;
          }
        }
        transaction.set(ref, {
          code,
          clip: shareClip,
          createdAt: globalThis.firebase.firestore.Timestamp.fromDate(now),
          expiresAt: globalThis.firebase.firestore.Timestamp.fromDate(expiresAt),
        });
        return true;
      });
      if (!saved) {
        continue;
      }
      elements.shareCodeLine.textContent = `Code ${code} shares ${clips.length} ${clips.length === 1 ? "clip" : "clips"} for 1 hour.`;
      setStatus(`Code ${code} is ready for ${clips.length} ${clips.length === 1 ? "clip" : "clips"}.`);
      return;
    } catch {
      setStatus("Code generation failed. Check Firestore rules.");
      return;
    }
  }

  setStatus("Could not find an unused code. Try again.");
}

async function retrieveShareCode() {
  const collection = shareCollection();
  if (!collection) {
    setStatus("Code transfer needs Firebase config.");
    return;
  }

  const code = normalizeShareCode(elements.retrieveCodeInput.value);
  elements.retrieveCodeInput.value = code;
  if (code.length !== 6) {
    setStatus("Enter a 6-digit retrieval code.");
    return;
  }

  try {
    const snapshot = await collection.doc(code).get();
    if (!snapshot.exists) {
      setStatus("No active clip found for that code.");
      return;
    }
    const data = snapshot.data();
    const expiresAt = data?.expiresAt?.toDate?.();
    if (!expiresAt || expiresAt <= new Date()) {
      setStatus("That code has expired.");
      return;
    }
    const rawClips = clipsFromShareData(data);
    const clips = normalizeClips(rawClips.map((clip) => ({ ...clip, createdAt: new Date().toISOString() })));
    if (!clips.length) {
      setStatus("That code does not contain a valid clip.");
      return;
    }
    for (const clip of clips) {
      await addClip(clip);
    }
    elements.retrieveCodeInput.value = "";
    setStatus(`Retrieved ${clips.length} ${clips.length === 1 ? "clip" : "clips"} from code ${code}.`);
  } catch {
    setStatus("Retrieve failed. Check the code or Firestore rules.");
  }
}

async function addClip(partial) {
  const existingPosition = state.index.get(partial.digest);
  let changedClip;
  if (existingPosition !== undefined) {
    const existing = state.clips[existingPosition];
    existing.createdAt = new Date().toISOString();
    existing.title = partial.title || existing.title;
    existing.folder = partial.folder || existing.folder;
    state.clips.splice(existingPosition, 1);
    state.clips.unshift(existing);
    changedClip = existing;
    setStatus("Duplicate moved to the top.");
  } else {
    changedClip = {
      id: makeId(),
      pinned: false,
      createdAt: new Date().toISOString(),
      title: "",
      folder: "",
      tags: [],
      ...partial,
    };
    state.clips.unshift(changedClip);
    setStatus(partial.kind === "image" ? "Screenshot saved." : "Saved new clip.");
  }

  rebuildIndex();
  trimHistory();
  persistWithQuotaTrim();
  if (!state.index.has(partial.digest)) {
    setStatus("That clip was larger than the browser storage limit.");
  } else {
    saveRemoteClip(changedClip);
  }
  render();
}

async function updateTextClip(id, text) {
  const clip = state.clips.find((item) => item.id === id);
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clip || clip.kind !== "text" || !normalized) {
    setStatus("Text edit was empty, so it was not saved.");
    return;
  }

  const previousDigest = clip.digest;
  clip.text = normalized;
  clip.createdAt = new Date().toISOString();
  clip.digest = await digestValue(`text:${normalized}`);
  rebuildIndex();
  persistWithQuotaTrim();
  if (previousDigest !== clip.digest) {
    deleteRemoteClip({ digest: previousDigest });
  }
  saveRemoteClip(clip);
  setStatus("Text clip updated.");
  render();
}

async function updateImageClip(clip, imageData) {
  if (!clip || clip.kind !== "image") {
    return;
  }
  const previousDigest = clip.digest;
  clip.imageData = imageData;
  clip.title = "Edited screenshot";
  clip.createdAt = new Date().toISOString();
  clip.digest = await digestValue(`image:${imageData}`);
  rebuildIndex();
  trimHistory();
  persistWithQuotaTrim();
  if (previousDigest !== clip.digest) {
    deleteRemoteClip({ digest: previousDigest });
  }
  saveRemoteClip(clip);
  setStatus("Screenshot updated.");
  render();
}

function updateClipDetails(id, title, folder, tags) {
  const clip = state.clips.find((item) => item.id === id);
  if (!clip) {
    return;
  }
  clip.title = String(title || "").trim();
  clip.folder = String(folder || "").trim();
  clip.tags = parseTags(tags);
  persistWithQuotaTrim();
  saveRemoteClip(clip);
  setStatus("Clip details updated.");
  render();
}

function trimHistory() {
  let changed = false;
  while (state.clips.length > MAX_ITEMS || estimatedBytes() > MAX_STORAGE_BYTES) {
    const removableIndex = findLastRemovableIndex();
    if (removableIndex === -1) {
      break;
    }
    state.clips.splice(removableIndex, 1);
    changed = true;
  }
  if (changed) {
    rebuildIndex();
  }
}

function findLastRemovableIndex() {
  for (let index = state.clips.length - 1; index >= 0; index -= 1) {
    if (!state.clips[index].pinned) {
      return index;
    }
  }
  return state.clips.length - 1;
}

function estimatedBytes() {
  let bytes = 2;
  for (const clip of state.clips) {
    bytes += estimatedClipBytes(clip);
  }
  return bytes;
}

function estimatedClipBytes(clip) {
  const title = typeof clip.title === "string" ? clip.title : "";
  const folder = typeof clip.folder === "string" ? clip.folder : "";
  const tags = normalizeTags(clip.tags);
  return 220
    + title.length
    + folder.length
    + tags.join(",").length
    + (clip.kind === "image" ? clip.imageData.length : clip.text.length);
}

function deleteClip(id) {
  const clip = state.clips.find((item) => item.id === id);
  state.clips = state.clips.filter((clip) => clip.id !== id);
  state.selectedIds.delete(id);
  rebuildIndex();
  persistWithQuotaTrim();
  deleteRemoteClip(clip);
  setStatus("Clip deleted.");
  render();
}

function selectVisibleClips() {
  filteredClips().forEach((clip) => state.selectedIds.add(clip.id));
  render();
}

function clearSelection() {
  state.selectedIds.clear();
  render();
}

function pinSelectedClips() {
  const selected = new Set(state.selectedIds);
  let changed = false;
  state.clips.forEach((clip) => {
    if (selected.has(clip.id) && !clip.pinned) {
      clip.pinned = true;
      saveRemoteClip(clip);
      changed = true;
    }
  });
  if (!changed) {
    setStatus("Selected clips are already pinned.");
    return;
  }
  persistWithQuotaTrim();
  setStatus(`Pinned ${selected.size} selected clips.`);
  render();
}

function deleteSelectedClips() {
  const selected = new Set(state.selectedIds);
  if (!selected.size) {
    return;
  }
  const removed = state.clips.filter((clip) => selected.has(clip.id));
  state.clips = state.clips.filter((clip) => !selected.has(clip.id));
  state.selectedIds.clear();
  rebuildIndex();
  persistWithQuotaTrim();
  removed.forEach(deleteRemoteClip);
  setStatus(`Deleted ${removed.length} selected clips.`);
  render();
}

function togglePin(id) {
  const clip = state.clips.find((item) => item.id === id);
  if (!clip) {
    return;
  }
  clip.pinned = !clip.pinned;
  persistWithQuotaTrim();
  saveRemoteClip(clip);
  render();
}

async function copyClip(clip) {
  if (clip.kind === "image") {
    await copyImageClip(clip);
    return;
  }

  try {
    await navigator.clipboard.writeText(clip.text);
    setStatus("Copied back to clipboard.");
  } catch {
    elements.clipInput.value = clip.text;
    elements.clipInput.select();
    setStatus("Clipboard write was blocked. Text is selected in the capture box.");
  }
}

async function copyImageClip(clip) {
  if (!navigator.clipboard?.write || !globalThis.ClipboardItem) {
    downloadImage(clip);
    setStatus("Image clipboard write is unavailable. Download started instead.");
    return;
  }

  try {
    const blob = await dataUrlToBlob(clip.imageData);
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    setStatus("Screenshot copied as an image.");
  } catch {
    downloadImage(clip);
    setStatus("Image clipboard write was blocked. Download started instead.");
  }
}

async function readClipboard() {
  if (!navigator.clipboard?.read && !navigator.clipboard?.readText) {
    setStatus("This browser does not support clipboard reads.");
    elements.permissionPill.textContent = "Unavailable";
    return;
  }

  const imageRead = await readImageFromClipboard();
  if (imageRead) {
    return;
  }

  if (!navigator.clipboard?.readText) {
    setStatus("Image clipboard read is blocked here. Click the capture box and paste instead.");
    elements.permissionPill.textContent = "Paste instead";
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    elements.clipInput.value = text;
    await addTextClip(text);
    elements.permissionPill.textContent = "Allowed";
  } catch {
    elements.permissionPill.textContent = "Needs permission";
    setStatus("Clipboard read was blocked. Use paste in the capture box instead.");
  }
}

async function readImageFromClipboard() {
  if (!navigator.clipboard?.read) {
    return false;
  }

  try {
    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) {
        continue;
      }
      const blob = await item.getType(imageType);
      const file = new File([blob], "clipboard-image", { type: blob.type || imageType });
      const imageData = await imageFileToClipData(file);
      await addImageClip(imageData, "Clipboard image");
      elements.permissionPill.textContent = "Image allowed";
      elements.clipInput.value = "";
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function captureScreenshot() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus("This browser does not support screen capture.");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
    });
    const settings = screenshotSettings();
    const imageData = await snapshotStream(stream, settings);
    await addImageClip(imageData, "Screenshot");
    elements.permissionPill.textContent = "Screen allowed";
  } catch {
    setStatus("Screenshot capture was cancelled or blocked.");
  } finally {
    stopStream(stream);
  }
}

function screenshotSettings() {
  const presetName = elements.screenshotPreset.value;
  const preset = SCREENSHOT_PRESETS[presetName] || SCREENSHOT_PRESETS.balanced;
  const customMaxEdge = clampNumber(Number(elements.screenshotMaxEdge.value), 320, 3840);

  return {
    maxEdge: presetName === "custom" ? customMaxEdge : preset.maxEdge,
    quality: presetName === "custom" ? 0.82 : preset.quality,
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function snapshotStream(stream, settings) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.addEventListener("loadedmetadata", async () => {
      try {
        await video.play();
        const { width, height } = fitSize(video.videoWidth, video.videoHeight, settings.maxEdge);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(video, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", settings.quality));
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    video.addEventListener("error", reject, { once: true });
  });
}

function fitSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function stopStream(stream) {
  if (!stream) {
    return;
  }
  stream.getTracks().forEach((track) => track.stop());
}

function filteredClips() {
  const query = state.query.trim().toLowerCase();
  const today = new Date().toDateString();

  return state.clips.filter((clip) => {
    if (state.dateFilter && clip.createdAt.slice(0, 10) !== state.dateFilter) {
      return false;
    }
    if (state.filter === "text" && clip.kind !== "text") {
      return false;
    }
    if (state.filter === "image" && clip.kind !== "image") {
      return false;
    }
    if (state.filter === "pinned" && !clip.pinned) {
      return false;
    }
    if (state.filter === "categorized" && !clip.folder) {
      return false;
    }
    if (state.filter === "today" && new Date(clip.createdAt).toDateString() !== today) {
      return false;
    }
    return !query || searchableText(clip).includes(query);
  });
}

function searchableText(clip) {
  return `${clip.kind} ${clip.title || ""} ${clip.folder || ""} ${normalizeTags(clip.tags).join(" ")} ${clip.text} ${clip.digest}`.toLowerCase();
}

function render() {
  elements.clipList.replaceChildren();
  for (const id of [...state.selectedIds]) {
    if (!state.clips.some((clip) => clip.id === id)) {
      state.selectedIds.delete(id);
    }
  }
  elements.categoryOptions.replaceChildren(...categoryOptions().map((category) => {
    const option = document.createElement("option");
    option.value = category;
    return option;
  }));
  const visible = filteredClips();

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.clips.length ? "No clips match the current filter." : "Paste, read clipboard text, or capture a screenshot to build your stack.";
    elements.clipList.append(empty);
  }

  for (const clip of visible) {
    const fragment = elements.clipTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".clip-card");
    const selectInput = fragment.querySelector(".select-action");
    const time = fragment.querySelector("time");
    const title = fragment.querySelector(".clip-title");
    const pre = fragment.querySelector("pre");
    const image = fragment.querySelector("img");
    const copyButton = fragment.querySelector(".copy-action");
    const editButton = fragment.querySelector(".edit-action");
    const detailsButton = fragment.querySelector(".details-action");
    const pinButton = fragment.querySelector(".pin-action");
    const downloadButton = fragment.querySelector(".download-action");
    const deleteButton = fragment.querySelector(".delete-action");

    card.classList.toggle("is-pinned", clip.pinned);
    card.classList.toggle("is-selected", state.selectedIds.has(clip.id));
    selectInput.checked = state.selectedIds.has(clip.id);
    selectInput.addEventListener("change", () => {
      if (selectInput.checked) {
        state.selectedIds.add(clip.id);
      } else {
        state.selectedIds.delete(clip.id);
      }
      render();
    });
    time.dateTime = clip.createdAt;
    time.textContent = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(clip.createdAt));
    title.hidden = true;
    title.textContent = "";
    if (clip.kind === "image") {
      pre.hidden = true;
      image.hidden = false;
      image.src = clip.imageData;
      image.alt = clip.title || "Captured screenshot";
      downloadButton.hidden = false;
      downloadButton.addEventListener("click", () => downloadImage(clip));
      copyButton.textContent = "Copy Image";
      editButton.textContent = "Annotate / Crop";
      editButton.addEventListener("click", () => openImageEditor(clip));
    } else {
      pre.hidden = false;
      pre.textContent = clip.text;
      image.hidden = true;
      downloadButton.hidden = true;
      copyButton.textContent = "Copy";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => startTextEdit(card, clip));
    }

    copyButton.addEventListener("click", () => copyClip(clip));
    detailsButton.addEventListener("click", () => startDetailsEdit(card, clip));
    pinButton.textContent = clip.pinned ? "Unpin" : "Pin";
    pinButton.addEventListener("click", () => togglePin(clip.id));
    deleteButton.addEventListener("click", () => deleteClip(clip.id));

    elements.clipList.append(fragment);
  }

  renderMetrics();
  renderSelectionUi(visible);
}

function renderSelectionUi(visible) {
  const selectedCount = state.selectedIds.size;
  elements.selectionLine.textContent = `${selectedCount} selected`;
  elements.pinSelectedButton.disabled = selectedCount === 0;
  elements.deleteSelectedButton.disabled = selectedCount === 0;
  elements.clearSelectionButton.disabled = selectedCount === 0;
  elements.selectAllButton.disabled = visible.length === 0;
}

function renderMetrics() {
  elements.metricTotal.textContent = String(state.clips.length);
  elements.metricPinned.textContent = String(state.clips.filter((clip) => clip.pinned).length);
  elements.metricBytes.textContent = `${formatBytes(estimatedBytes())} / ${formatBytes(MAX_STORAGE_BYTES)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(message) {
  elements.statusLine.textContent = message;
}

function openAccountModal() {
  elements.accountModal.hidden = false;
}

function closeAccountModal() {
  elements.accountModal.hidden = true;
}

function openTransferModal() {
  elements.transferModal.hidden = false;
}

function closeTransferModal() {
  elements.transferModal.hidden = true;
}

function defaultClipTitle(clip) {
  return clip.kind === "image" ? "Screenshot" : firstLine(clip.text);
}

function firstLine(text) {
  const line = String(text || "").trim().split("\n")[0] || "Text clip";
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

function startTextEdit(card, clip) {
  const pre = card.querySelector("pre");
  const actions = card.querySelector(".clip-actions");
  pre.hidden = true;

  const editor = document.createElement("textarea");
  editor.className = "clip-editor";
  editor.value = clip.text;
  editor.spellcheck = false;

  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const editActions = document.createElement("div");
  editActions.className = "edit-actions";
  editActions.append(saveButton, cancelButton);
  pre.after(editor, editActions);
  editor.focus();

  saveButton.addEventListener("click", () => updateTextClip(clip.id, editor.value));
  cancelButton.addEventListener("click", () => render());
  actions.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
}

function startDetailsEdit(card, clip) {
  const title = card.querySelector(".clip-title");
  const actions = card.querySelector(".clip-actions");
  title.hidden = true;

  const form = document.createElement("div");
  form.className = "details-editor";

  const titleLabel = document.createElement("label");
  titleLabel.textContent = "Title";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = clip.title || defaultClipTitle(clip);

  const folderLabel = document.createElement("label");
  folderLabel.textContent = "Folder";
  const folderInput = document.createElement("input");
  folderInput.type = "text";
  folderInput.value = clip.folder || "";
  folderInput.placeholder = "work, school, ideas";

  const tagLabel = document.createElement("label");
  tagLabel.textContent = "Tags";
  const tagInput = document.createElement("input");
  tagInput.type = "text";
  tagInput.value = normalizeTags(clip.tags).join(", ");
  tagInput.placeholder = "work, idea, screenshot";

  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "button";
  saveButton.textContent = "Save Details";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const editActions = document.createElement("div");
  editActions.className = "edit-actions";
  editActions.append(saveButton, cancelButton);
  form.append(titleLabel, titleInput, folderLabel, folderInput, tagLabel, tagInput, editActions);
  title.after(form);
  titleInput.focus();

  saveButton.addEventListener("click", () => updateClipDetails(clip.id, titleInput.value, folderInput.value, tagInput.value));
  cancelButton.addEventListener("click", () => render());
  actions.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.clips, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clipboardstack-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Backup downloaded.");
}

function importJson(file) {
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const parsed = JSON.parse(String(reader.result || "[]"));
      if (!Array.isArray(parsed)) {
        throw new Error("Expected an array");
      }

      const imported = normalizeClips(parsed);
      for (const clip of imported) {
        const content = clip.kind === "image" ? clip.imageData : clip.text;
        if (!clip.digest || clip.digest.startsWith("fnv:")) {
          clip.digest = await digestValue(`${clip.kind}:${content}`);
        }
      }

      state.clips = mergeClipLists(imported, state.clips);
      rebuildIndex();
      trimHistory();
      persistWithQuotaTrim();
      syncAllLocalClips();
      setStatus(`Imported ${imported.length} clips.`);
      render();
    } catch {
      setStatus("Import failed. Choose a ClipboardStack JSON export.");
    }
  });
  reader.readAsText(file);
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", reject, { once: true });
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = dataUrl;
  });
}

async function imageFileToClipData(file) {
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const settings = screenshotSettings();
  const { width, height } = fitSize(image.naturalWidth || image.width, image.naturalHeight || image.height, settings.maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", settings.quality);
}

async function handleCapturePaste(event) {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  if (!imageItem) {
    window.setTimeout(() => addTextClip(elements.clipInput.value), 0);
    return;
  }

  const file = imageItem.getAsFile();
  if (!file) {
    return;
  }

  event.preventDefault();
  try {
    const imageData = await imageFileToClipData(file);
    await addImageClip(imageData, "Pasted screenshot");
    elements.permissionPill.textContent = "Paste image";
    elements.clipInput.value = "";
  } catch {
    setStatus("Image paste failed. Try Screenshot or upload/export instead.");
  }
}

function downloadImage(clip) {
  const link = document.createElement("a");
  link.href = clip.imageData;
  link.download = `clipboardstack-screenshot-${clip.createdAt.slice(0, 10)}.jpg`;
  link.click();
}

function canvasContext() {
  return elements.editorCanvas.getContext("2d", { willReadFrequently: true });
}

function setEditorMode(mode) {
  state.editor.mode = mode;
  state.editor.cropBox = null;
  elements.drawModeButton.classList.toggle("is-active", mode === "draw");
  elements.cropModeButton.classList.toggle("is-active", mode === "crop");
  elements.editorStatus.textContent = mode === "draw"
    ? "Drag on the screenshot to draw."
    : "Drag a rectangle on the screenshot to crop it.";
}

function openImageEditor(clip) {
  const image = new Image();
  image.addEventListener("load", () => {
    state.editor.clip = clip;
    state.editor.image = image;
    state.editor.history = [];
    state.editor.isPointerDown = false;
    state.editor.lastPoint = null;
    state.editor.cropStart = null;
    state.editor.cropBox = null;
    state.editor.cropBase = null;
    elements.editorCanvas.width = image.naturalWidth;
    elements.editorCanvas.height = image.naturalHeight;
    canvasContext().drawImage(image, 0, 0);
    pushEditorHistory();
    setEditorMode("draw");
    elements.imageEditor.hidden = false;
  }, { once: true });
  image.src = clip.imageData;
}

function closeImageEditor() {
  elements.imageEditor.hidden = true;
  state.editor.clip = null;
  state.editor.image = null;
  state.editor.history = [];
  state.editor.isPointerDown = false;
}

function pushEditorHistory() {
  state.editor.history.push(elements.editorCanvas.toDataURL("image/jpeg", 0.9));
  if (state.editor.history.length > 20) {
    state.editor.history.shift();
  }
}

function restoreEditorImage(dataUrl) {
  const image = new Image();
  image.addEventListener("load", () => {
    elements.editorCanvas.width = image.naturalWidth;
    elements.editorCanvas.height = image.naturalHeight;
    canvasContext().drawImage(image, 0, 0);
  }, { once: true });
  image.src = dataUrl;
}

function undoEditor() {
  if (state.editor.history.length <= 1) {
    return;
  }
  state.editor.history.pop();
  restoreEditorImage(state.editor.history[state.editor.history.length - 1]);
  elements.editorStatus.textContent = "Last edit undone.";
}

function resetEditor() {
  if (!state.editor.image) {
    return;
  }
  elements.editorCanvas.width = state.editor.image.naturalWidth;
  elements.editorCanvas.height = state.editor.image.naturalHeight;
  canvasContext().drawImage(state.editor.image, 0, 0);
  state.editor.history = [];
  state.editor.cropBase = null;
  state.editor.cropBox = null;
  pushEditorHistory();
  elements.editorStatus.textContent = "Screenshot reset to the original capture.";
}

function editorPoint(event) {
  const rect = elements.editorCanvas.getBoundingClientRect();
  return {
    x: clampNumber(((event.clientX - rect.left) / rect.width) * elements.editorCanvas.width, 0, elements.editorCanvas.width),
    y: clampNumber(((event.clientY - rect.top) / rect.height) * elements.editorCanvas.height, 0, elements.editorCanvas.height),
  };
}

function beginEditorPointer(event) {
  if (!state.editor.clip) {
    return;
  }
  event.preventDefault();
  elements.editorCanvas.setPointerCapture(event.pointerId);
  state.editor.isPointerDown = true;
  const point = editorPoint(event);
  if (state.editor.mode === "draw") {
    pushEditorHistory();
    state.editor.lastPoint = point;
    return;
  }
  state.editor.cropStart = point;
  state.editor.cropBox = null;
  pushEditorHistory();
  state.editor.cropBase = canvasContext().getImageData(0, 0, elements.editorCanvas.width, elements.editorCanvas.height);
}

function moveEditorPointer(event) {
  if (!state.editor.isPointerDown) {
    return;
  }
  event.preventDefault();
  const point = editorPoint(event);
  if (state.editor.mode === "draw") {
    drawEditorLine(state.editor.lastPoint, point);
    state.editor.lastPoint = point;
    return;
  }
  previewCropBox(point);
}

function endEditorPointer(event) {
  if (!state.editor.isPointerDown) {
    return;
  }
  event.preventDefault();
  state.editor.isPointerDown = false;
  if (state.editor.mode === "draw") {
    state.editor.lastPoint = null;
    return;
  }
  applyCrop();
}

function drawEditorLine(start, end) {
  const context = canvasContext();
  context.save();
  context.strokeStyle = elements.drawColorInput.value;
  context.lineWidth = Number(elements.drawSizeInput.value);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function cropRect(from, to) {
  const left = Math.min(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { left, top, width, height };
}

function previewCropBox(point) {
  const latest = state.editor.history[state.editor.history.length - 1];
  if (state.editor.cropBase) {
    canvasContext().putImageData(state.editor.cropBase, 0, 0);
  } else if (latest) {
    restoreEditorImage(latest);
  }
  const box = cropRect(state.editor.cropStart, point);
  state.editor.cropBox = box;
  const context = canvasContext();
  context.save();
  context.strokeStyle = "#ff3b30";
  context.lineWidth = Math.max(2, Math.round(elements.editorCanvas.width / 360));
  context.setLineDash([10, 8]);
  context.strokeRect(box.left, box.top, box.width, box.height);
  context.restore();
}

function applyCrop() {
  const box = state.editor.cropBox;
  if (!box || box.width < 10 || box.height < 10) {
    if (state.editor.cropBase) {
      canvasContext().putImageData(state.editor.cropBase, 0, 0);
    } else {
      const latest = state.editor.history[state.editor.history.length - 1];
      if (latest) {
        restoreEditorImage(latest);
      }
    }
    elements.editorStatus.textContent = "Crop was too small.";
    state.editor.cropBase = null;
    return;
  }

  const source = document.createElement("canvas");
  source.width = elements.editorCanvas.width;
  source.height = elements.editorCanvas.height;
  if (state.editor.cropBase) {
    source.getContext("2d").putImageData(state.editor.cropBase, 0, 0);
  } else {
    source.getContext("2d").drawImage(elements.editorCanvas, 0, 0);
  }
  elements.editorCanvas.width = Math.round(box.width);
  elements.editorCanvas.height = Math.round(box.height);
  canvasContext().drawImage(source, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
  pushEditorHistory();
  state.editor.cropBox = null;
  state.editor.cropBase = null;
  elements.editorStatus.textContent = "Screenshot cropped.";
}

async function saveImageEditor() {
  if (!state.editor.clip) {
    return;
  }
  const edited = elements.editorCanvas.toDataURL("image/jpeg", 0.9);
  await updateImageClip(state.editor.clip, edited);
  closeImageEditor();
}

elements.saveTextButton.addEventListener("click", () => addTextClip(elements.clipInput.value));
elements.accountOpenButton.addEventListener("click", openAccountModal);
elements.accountCloseButton.addEventListener("click", closeAccountModal);
elements.transferOpenButton.addEventListener("click", openTransferModal);
elements.transferCloseButton.addEventListener("click", closeTransferModal);
elements.accountModal.addEventListener("click", (event) => {
  if (event.target === elements.accountModal) {
    closeAccountModal();
  }
});
elements.transferModal.addEventListener("click", (event) => {
  if (event.target === elements.transferModal) {
    closeTransferModal();
  }
});
elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.remote.available) {
    setAccountStatus("Add Firebase config before signing in.");
    return;
  }
  const { email, password } = authInputs();
  if (!isValidEmail(email)) {
    setAccountStatus("Use a real email address, like name@example.com.");
    return;
  }
  if (password.length < 6) {
    setAccountStatus("Password needs at least 6 characters.");
    return;
  }
  try {
    await state.remote.auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    setAccountStatus(authErrorMessage(error, "Sign in"));
  }
});
elements.createAccountButton.addEventListener("click", async () => {
  if (!state.remote.available) {
    setAccountStatus("Add Firebase config before creating accounts.");
    return;
  }
  const { email, password, confirmPassword } = authInputs();
  if (!isValidEmail(email)) {
    setAccountStatus("Use a real email address, like name@example.com.");
    return;
  }
  if (password.length < 6) {
    setAccountStatus("Password needs at least 6 characters.");
    return;
  }
  if (password !== confirmPassword) {
    setAccountStatus("Passwords do not match. Re-enter both password fields.");
    return;
  }
  try {
    const credential = await state.remote.auth.createUserWithEmailAndPassword(email, password);
    elements.confirmPasswordInput.value = "";
    try {
      await sendVerificationEmail(credential.user);
      setAccountStatus(verificationHelpText(email));
    } catch (verificationError) {
      setAccountStatus(`Account created, but verification email was not sent. ${authErrorMessage(verificationError, "Email verification")}`);
    }
  } catch (error) {
    setAccountStatus(authErrorMessage(error, "Account creation"));
  }
});
elements.forgotPasswordButton.addEventListener("click", async () => {
  if (!state.remote.available) {
    setAccountStatus("Add Firebase config before password reset.");
    return;
  }
  const email = elements.emailInput.value.trim();
  if (!isValidEmail(email)) {
    setAccountStatus("Enter your email first, then use Forgot Password.");
    return;
  }
  try {
    await state.remote.auth.sendPasswordResetEmail(email, verificationActionSettings());
    setAccountStatus(`Password reset email sent to ${email}. Check spam if it does not arrive in a few minutes.`);
  } catch (error) {
    setAccountStatus(authErrorMessage(error, "Password reset"));
  }
});
elements.verifyEmailButton.addEventListener("click", async () => {
  const user = state.remote.auth?.currentUser;
  if (!user) {
    return;
  }
  if (state.verificationCooldownUntil > Date.now()) {
    updateAccountUi();
    return;
  }
  try {
    await sendVerificationEmail(user);
    setAccountStatus(verificationHelpText(user.email));
  } catch (error) {
    setAccountStatus(authErrorMessage(error, "Email verification"));
  }
});
elements.refreshUserButton.addEventListener("click", async () => {
  await refreshVerificationStatus(false);
});
elements.changePasswordButton.addEventListener("click", changePassword);
elements.signOutButton.addEventListener("click", async () => {
  if (state.remote.auth) {
    await state.remote.auth.signOut();
  }
});
elements.editorCloseButton.addEventListener("click", closeImageEditor);
elements.drawModeButton.addEventListener("click", () => setEditorMode("draw"));
elements.cropModeButton.addEventListener("click", () => setEditorMode("crop"));
elements.editorUndoButton.addEventListener("click", undoEditor);
elements.editorResetButton.addEventListener("click", resetEditor);
elements.editorSaveButton.addEventListener("click", saveImageEditor);
elements.editorCanvas.addEventListener("pointerdown", beginEditorPointer);
elements.editorCanvas.addEventListener("pointermove", moveEditorPointer);
elements.editorCanvas.addEventListener("pointerup", endEditorPointer);
elements.editorCanvas.addEventListener("pointercancel", endEditorPointer);
elements.imageEditor.addEventListener("click", (event) => {
  if (event.target === elements.imageEditor) {
    closeImageEditor();
  }
});
elements.readClipboardButton.addEventListener("click", readClipboard);
elements.screenshotButton.addEventListener("click", captureScreenshot);
elements.shareCodeButton.addEventListener("click", generateShareCode);
elements.retrieveCodeButton.addEventListener("click", retrieveShareCode);
elements.retrieveCodeInput.addEventListener("input", (event) => {
  event.target.value = normalizeShareCode(event.target.value);
});
elements.retrieveCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    retrieveShareCode();
  }
});
elements.screenshotPreset.addEventListener("change", () => {
  const preset = SCREENSHOT_PRESETS[elements.screenshotPreset.value];
  elements.screenshotMaxEdge.disabled = Boolean(preset);
  if (preset) {
    elements.screenshotMaxEdge.value = String(preset.maxEdge);
  }
});
elements.exportButton.addEventListener("click", exportJson);
elements.clearButton.addEventListener("click", () => {
  state.clips = [];
  state.selectedIds.clear();
  rebuildIndex();
  persistWithQuotaTrim();
  clearRemoteClips();
  setStatus("History cleared.");
  render();
});
elements.selectAllButton.addEventListener("click", selectVisibleClips);
elements.pinSelectedButton.addEventListener("click", pinSelectedClips);
elements.deleteSelectedButton.addEventListener("click", deleteSelectedClips);
elements.clearSelectionButton.addEventListener("click", clearSelection);
elements.importFile.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    importJson(file);
  }
  event.target.value = "";
});
elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
elements.dateFilterInput.addEventListener("change", (event) => {
  state.dateFilter = event.target.value;
  render();
});
elements.filterSelect.addEventListener("change", (event) => {
  state.filter = event.target.value;
  render();
});
elements.clipInput.addEventListener("paste", handleCapturePaste);

render();
