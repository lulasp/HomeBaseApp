import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { reminderDate, reminderSignature, shouldScheduleReminder } from '../utils/reminders';

// expo-notifications has no web implementation — every call here is a no-op on
// web. Reminder times still round-trip through Firestore, so a time set on the
// desktop is picked up and scheduled by the phone.
export const remindersSupported = () => Platform.OS !== 'web';

const CHANNEL_ID = 'todo-reminders';

let handlerInstalled = false;

// Foreground notifications are silent by default; this makes them visible.
export function installNotificationHandler() {
  if (!remindersSupported() || handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Task reminders',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

// Asks only if we don't already hold permission, so setting a second reminder
// doesn't re-prompt. Returns true when we may schedule.
export async function ensureNotificationPermission() {
  if (!remindersSupported()) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) { await ensureAndroidChannel(); return true; }
  if (current.canAskAgain === false) return false;
  const requested = await Notifications.requestPermissionsAsync();
  if (!requested.granted) return false;
  await ensureAndroidChannel();
  return true;
}

// The todo id doubles as the notification identifier, so re-scheduling replaces
// the previous notification and cancelling needs no bookkeeping.
export async function scheduleTodoReminder(todo) {
  if (!remindersSupported()) return null;
  const date = reminderDate(todo.weekKey, todo.day, todo.remindTime);
  if (!date) return null;
  return Notifications.scheduleNotificationAsync({
    identifier: todo.id,
    content: {
      title: 'Task reminder',
      body: todo.text,
      data: { todoId: todo.id, day: todo.day },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}

export async function cancelTodoReminder(todoId) {
  if (!remindersSupported()) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(todoId);
  } catch {
    // Cancelling an identifier that was never scheduled is not an error here.
  }
}

/**
 * Reconciles OS-level notifications with the current todos.
 *
 * `known` is a Map of todoId → signature carried across calls by the caller, so
 * an unchanged todo costs no native calls. Returns the next Map.
 */
export async function syncTodoReminders(todos, uid, known = new Map(), now = new Date()) {
  if (!remindersSupported()) return known;
  const next = new Map();
  const seen = new Set();

  for (const todo of todos) {
    seen.add(todo.id);
    const signature = reminderSignature(todo, uid, now);
    const previous = known.get(todo.id);
    if (!signature) {
      if (previous) await cancelTodoReminder(todo.id);   // cleared, done, or now past
      continue;
    }
    next.set(todo.id, signature);
    if (signature === previous) continue;                // unchanged — leave the OS alone
    if (shouldScheduleReminder(todo, uid, now)) {
      try {
        await scheduleTodoReminder(todo);
      } catch (err) {
        console.error('Could not schedule reminder', err);
        next.delete(todo.id);                            // retry on the next sync
      }
    }
  }

  // Todos that vanished (deleted, or moved out of the week we subscribe to).
  for (const todoId of known.keys()) {
    if (!seen.has(todoId)) await cancelTodoReminder(todoId);
  }

  return next;
}
